package tasks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/models/tables"
	"json_trans_api/pkg/httpclient"
	"json_trans_api/pkg/logger"
	"json_trans_api/pkg/translate"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

const (
	TranslateCreate = "translate:create"
)

var AsynqClient *asynq.Client

type TranslateTaskPayload struct {
	Userid       string `json:"userid"`
	Id           string `json:"id"`
	TaskID       string `json:"task_id"`       // 新增的 TaskID 字段
	IsTranslated bool   `json:"is_translated"` // 新增的翻译状态字段
	CharTotal    int    `json:"char_total"`
}

type TranslatedData struct {
	Content []string `json:"content"`
}

type TranslatePayload struct {
	JsonContentRaw string `json:"json_content_raw"`
	FromLang       string `json:"from_lang"`
	ToLang         string `json:"to_lang"`
}

type TranslateResponse struct {
	Msg  string `json:"msg"`
	Code int    `json:"code"`
	Data string `json:"data"`
}

type WebhookResponse struct {
	Msg  string `json:"msg"`
	Code int    `json:"code"`
	Data string `json:"data"`
}

type SendRetry struct {
	WebhookID int             `json:"webhook_id"`
	TaskID    string          `json:"task_id"`    // 新增的 TaskID 字段
	Attempt   int             `json:"attempt"`    // 当前重试次数
	Status    string          `json:"status"`     // 发送状态
	CreatedAt time.Time       `json:"created_at"` // 创建时间
	UpdatedAt time.Time       `json:"updated_at"` // 更新时间
	Payload   json.RawMessage `json:"payload"`    // 发送的内容
}

type TranslationTask struct {
	UserID            string
	TranslationResult string
	TaskID            string // 添加 taskID 字段
}

func init() {
	AsynqClient = asynq.NewClient(asynq.RedisClientOpt{Addr: fmt.Sprintf("%s:%d", config.Cfg.Redis.Host, config.Cfg.Redis.Port), Password: config.Cfg.Redis.Password})
}

// 发送队列通道
var sendQueue = make(chan TranslationTask)

// 启动发送队列处理器
func StartSendQueue() {
	go func() {
		for task := range sendQueue {
			// 处理发送任务并进行重试
			retrySendTranslationResult(task.UserID, task.TranslationResult, task.TaskID, 3)
		}
	}()
}

// 创建翻译任务
func NewTranslateCreateTask(userid string, id string, char_total int) (*asynq.Task, error) {
	taskID := uuid.New().String() // 生成唯一的 taskid
	payload, err := json.Marshal(TranslateTaskPayload{Userid: userid, Id: id, TaskID: taskID, IsTranslated: false, CharTotal: char_total})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TranslateCreate, payload), nil
}

// 处理翻译创建任务
func HandleTranslateCreateTask(ctx context.Context, t *asynq.Task) error {
	var p TranslateTaskPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("json.Unmarshal failed: %v: %w", err, asynq.SkipRetry)
	}

	// 获取用户JSON数据
	userData, err := fetchDataById(p.Id)
	if err != nil {
		return fmt.Errorf("failed to fetch user data: %v", err)
	}

	// 执行JSON翻译
	translatedJson, err := translate.TranslateJson(userData.OriginJSON, userData.FromLang, userData.ToLang, userData.IgnoredFields)

	// 更新用户 JSON 数据的翻译状态
	if err != nil {
		updateUserJsonDataStatus(userData, p.TaskID, false) // 更新翻译失败的状态
		return fmt.Errorf("translation failed: %v", err)
	}

	// Json Encoder 会在末尾换行符号，手动去掉
	translatedJson = strings.TrimRight(translatedJson, "\n")

	// 准备更新数据
	updateData := map[string]interface{}{
		"translated_json": translatedJson,
		"update_time":     time.Now().UTC().Format(time.RFC3339),
	}

	// 执行Supabase更新
	_, err = updateUserJsonTranslations(p.Id, updateData)
	if err != nil {
		updateUserJsonDataStatus(userData, p.TaskID, false) // 更新翻译失败的状态
		return fmt.Errorf("failed to update translated data: %v", err)
	}

	log.Printf("Translate JSON Successful: userid=%s, id=%s", p.Userid, p.Id)

	// 更新用户 JSON 数据的翻译状态
	err = updateUserJsonDataStatus(userData, p.TaskID, true)
	if err != nil {
		// TODO: 失败处理
		fmt.Println(err)
	}

	// 记录每次翻译的字符使用日志
	err = addCharacterUsageLog(p.Id, p.Userid, p.CharTotal)
	if err != nil {
		// TODO: 失败处理
		fmt.Println(err)
	}

	// 更新用户历史总使用字符数量和月度字符使用数量
	err = updateUserCharacterUsage(p.Userid, p.CharTotal)
	if err != nil {
		// TODO: 失败处理
		fmt.Println(err)
	}

	// 如果有webhook的设置，进行翻译webhook的发送
	webhook_config_list, err := getWebhookConfig(p.Userid)
	if err != nil {
		return err
	}

	if len(webhook_config_list) > 0 {
		sendQueue <- TranslationTask{
			UserID:            p.Userid,
			TranslationResult: translatedJson,
			TaskID:            p.TaskID, // 从 p 中获取 TaskID
		}
	}

	return nil
}

// 更新用户 JSON 数据的翻译状态
func updateUserJsonDataStatus(userData *tables.UserJsonData, taskID string, isSuccess bool) error {
	updateData := map[string]interface{}{
		"task_id":       taskID,
		"is_translated": isSuccess,
		"update_time":   time.Now().UTC().Format(time.RFC3339),
	}

	_, err := updateUserJsonTranslations(userData.Id, updateData)
	return err
}

// fetchDataById 根据 ID 获取用户 JSON 数据
func fetchDataById(id string) (*tables.UserJsonData, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("id", "eq."+id)
	queryParams.Add("limit", "1")

	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create GET request: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("supabase request error: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	var userData []tables.UserJsonData
	err = json.Unmarshal(bodyBytes, &userData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse response: %v", err)
	}

	if len(userData) == 0 {
		return nil, fmt.Errorf("user_json_translations not found")
	}

	return &userData[0], nil
}

// retrySendTranslationResult 尝试发送翻译结果并进行重试
func retrySendTranslationResult(userID string, translationResult string, taskID string, maxRetries int) {
	// 获取用户的Webhook配置
	webhookConfig, err := getWebhookConfig(userID)
	if err != nil {
		log.Println("获取Webhook配置出错:", err)
		return
	}

	if len(webhookConfig) == 0 {
		return
	}

	// 准备要发送的内容
	payload := WebhookResponse{
		Code: 200,
		Msg:  "Success",
		Data: translationResult,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Println("序列化payload出错:", err)
		return
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {

		// 发送HTTP POST请求到用户的Webhook URL
		response, err := http.Post(webhookConfig[0].WebhookURL, "application/json", bytes.NewBuffer(payloadBytes))
		if err != nil || response.StatusCode != http.StatusOK {
			// 记录失败的重试
			if recordErr := recordSendRetry(webhookConfig[0].ID, taskID, "failed", attempt, payloadBytes); recordErr != nil {
				log.Println("记录发送重试出错:", recordErr)
			}
			log.Printf("第%d/%d次尝试：发送翻译结果出错: %v", attempt, maxRetries, err)
			time.Sleep(2 * time.Second) // 重试前等待
			continue
		}

		// 记录成功的发送并退出重试循环
		if recordErr := recordSendRetry(webhookConfig[0].ID, taskID, "success", attempt, payloadBytes); recordErr != nil {
			log.Println("记录发送重试出错:", recordErr)
		}
		log.Printf("成功发送翻译结果: userid=%s", userID)
		return
	}
}

// recordSendRetry 记录发送重试的状态
func recordSendRetry(webhookID int, taskID string, status string, attempt int, payload []byte) error {
	baseURL := fmt.Sprintf("%s/rest/v1/send_retry", config.Cfg.Supabase.SupabaseUrl)
	retry := SendRetry{
		WebhookID: webhookID,
		TaskID:    taskID, // 使用传入的 Task ID
		Attempt:   attempt,
		Status:    status,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Payload:   payload,
	}
	retryBytes, err := json.Marshal(retry)
	if err != nil {
		return fmt.Errorf("序列化重试记录失败: %v", err)
	}

	req, err := http.NewRequest("POST", baseURL, bytes.NewBuffer(retryBytes))
	if err != nil {
		return fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("记录发送重试失败: %s, %s", resp.Status, string(bodyBytes))
	}

	return nil
}

// getWebhookConfig 获取用户的Webhook配置
func getWebhookConfig(user_id string) ([]models.WebhookConfig, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("user_id", "eq."+user_id)

	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)

		return nil, fmt.Errorf("获取Webhook配置失败: %s", string(bodyBytes))
	}

	var webhookConfigs []models.WebhookConfig
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	err = json.Unmarshal(bodyBytes, &webhookConfigs)
	if err != nil {
		return nil, fmt.Errorf("解析响应失败: %v", err)
	}

	return webhookConfigs, nil
}

func updateUserJsonTranslations(id string, update_data map[string]interface{}) (*tables.UserJsonData, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("id", "eq."+id)
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	updatePayload, err := json.Marshal(update_data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal update data: %v", err)
	}

	req, err := http.NewRequest("PATCH", fullURL, bytes.NewBuffer(updatePayload))
	if err != nil {
		return nil, fmt.Errorf("failed to create PATCH request: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Prefer", "return=representation") // 要求返回更新后的记录

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("supabase update request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("update failed: %s, %s", resp.Status, string(bodyBytes))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read update response: %v", err)
	}

	var updatedUsers []tables.UserJsonData
	err = json.Unmarshal(bodyBytes, &updatedUsers)
	if err != nil {
		return nil, fmt.Errorf("failed to parse update response: %v", err)
	}

	if len(updatedUsers) == 0 {
		return nil, fmt.Errorf("no updated record returned")
	}

	return &updatedUsers[0], nil
}

func addCharacterUsageLog(json_id string, user_id string, total_characters int) error {
	logData := map[string]interface{}{
		"user_id":          user_id,
		"json_id":          json_id,
		"total_characters": total_characters,
		"create_time":      time.Now().UTC().Format(time.RFC3339),
	}

	jsonData, err := json.Marshal(logData)
	if err != nil {
		return fmt.Errorf("failed to marshal log data: %v", err)
	}

	supabaseURL := fmt.Sprintf("%s/rest/v1/character_usage_log", config.Cfg.Supabase.SupabaseUrl)
	req, err := http.NewRequest("POST", supabaseURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return err
	}

	return nil
}

func updateUserCharacterUsage(user_id string, char_count int) error {
	// 查询users表里面的字符总数
	baseURL := fmt.Sprintf("%s/rest/v1/users", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("id", "eq."+user_id)
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create GET request: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch user data: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetching user data failed: %s", resp.Status)
	}

	var users []tables.User
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %v", err)
	}

	err = json.Unmarshal(bodyBytes, &users)
	if err != nil || len(users) == 0 {
		return fmt.Errorf("failed to parse user data: %v", err)
	}

	currentUser := users[0]

	newTotalCharactersUsed := currentUser.TotalCharactersUsed + int64(char_count)
	newCharactersUsedThisMonth := currentUser.CharactersUsedThisMonth + int64(char_count)

	// 查询当日的character_usage_log_daily表里面的数据，先查询今日是否有数据
	current_date := time.Now().Format("2006-01-02")
	usage_daily_list, err := GetUsageByDate(user_id, current_date)
	if err != nil {
		return fmt.Errorf("failed to parse user data: %v", err)
	}

	// 如果当日有记录存在，那么就increment，如果没有就新增记录。使用这个表的目的是为了不去count字符使用量，后面量上来以后count肯定是有问题的
	var usage_today int64
	if len(usage_daily_list) > 0 {
		usage_today = usage_daily_list[0].TotalCharacters
		usage_today = usage_today + int64(char_count)
		err := UpdateUsageDaily(user_id, usage_today, current_date)
		if err != nil {
			logger.Logger.Error(err.Error())
		}
	} else {

		err := AddUsageDaily(user_id, int64(char_count), current_date)
		if err != nil {
			logger.Logger.Error(err.Error())
		}
	}

	// 对users表的字符记录数进行更新
	updateData := map[string]interface{}{
		"total_characters_used":      newTotalCharactersUsed,
		"characters_used_this_month": newCharactersUsedThisMonth,
	}

	updatePayload, err := json.Marshal(updateData)
	if err != nil {
		return fmt.Errorf("failed to marshal update data: %v", err)
	}

	// Send PATCH request to update the user data
	req, err = http.NewRequest("PATCH", fullURL, bytes.NewBuffer(updatePayload))
	if err != nil {
		return fmt.Errorf("failed to create PATCH request: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err = httpclient.Client.Do(req)
	if err != nil {
		return fmt.Errorf("supabase update request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update failed: %s, %s", resp.Status, string(bodyBytes))
	}

	return nil
}

func GetUsageByDate(user_id string, current_date string) ([]tables.UsageLogDaily, error) {

	baseURL := fmt.Sprintf("%s/rest/v1/character_usage_log_daily", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("user_id", "eq."+user_id)
	queryParams.Add("usage_date", "eq."+current_date)
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return []tables.UsageLogDaily{}, fmt.Errorf("failed to create GET request: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return []tables.UsageLogDaily{}, fmt.Errorf("failed to fetch user data: %v", err)
	}
	bodyBytes, err := io.ReadAll(resp.Body)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return []tables.UsageLogDaily{}, fmt.Errorf("fetching user data failed: %s", resp.Status)
	}

	var usage_log_daily []tables.UsageLogDaily
	if err != nil {
		return []tables.UsageLogDaily{}, fmt.Errorf("failed to read response body: %v", err)
	}

	err = json.Unmarshal(bodyBytes, &usage_log_daily)
	if err != nil {
		return []tables.UsageLogDaily{}, fmt.Errorf("failed to parse user data: %v", err)
	}

	return usage_log_daily, nil
}

func UpdateUsageDaily(user_id string, total_characters int64, current_date string) error {
	baseURL := fmt.Sprintf("%s/rest/v1/character_usage_log_daily", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("user_id", "eq."+user_id)
	queryParams.Add("usage_date", "eq."+current_date)
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	updateData := map[string]interface{}{
		"total_characters": total_characters,
	}

	updatePayload, err := json.Marshal(updateData)
	if err != nil {
		return fmt.Errorf("failed to marshal update data: %v", err)
	}

	req, err := http.NewRequest("PATCH", fullURL, bytes.NewBuffer(updatePayload))
	if err != nil {
		return fmt.Errorf("failed to create PATCH request: %v", err)
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return fmt.Errorf("supabase update request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return err
	}

	return nil
}

func AddUsageDaily(user_id string, total_characters int64, current_date string) error {
	userData := map[string]interface{}{
		"user_id":          user_id,
		"total_characters": total_characters,
		"usage_date":       current_date,
	}

	jsonData, err := json.Marshal(userData)
	if err != nil {
		return err
	}

	supabaseURL := fmt.Sprintf("%s/rest/v1/character_usage_log_daily", config.Cfg.Supabase.SupabaseUrl)
	req, err := http.NewRequest("POST", supabaseURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return err
	}

	return nil
}
