package webhook

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/models/tables"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"json_trans_api/pkg/tasks"
	"json_trans_api/service/api/middleware/auth"
	"json_trans_api/utils/validateurl"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"log"
	"github.com/go-chi/chi"
)

type WebhookHistoryResponse struct {
	History []tasks.SendRetry `json:"history"`
	Total   int               `json:"total"`
}

func AddConfig(w http.ResponseWriter, r *http.Request) {
	var webhookConfigRequest models.WebhookConfigRequest

	if err := json.NewDecoder(r.Body).Decode(&webhookConfigRequest); err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Invalid request payload",
			Data: map[string]interface{}{},
		})
		return
	}

	// 校验格式是否正确
	if !validateurl.ValidateURL(webhookConfigRequest.WebhookURL) {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "invalid URL format",
			Data: map[string]interface{}{},
		})
		return
	}

	baseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	newWebhookConfig := models.WebhookConfigCreate{
		UserID:     auth.GetUserIDFromContext(r),
		WebhookURL: webhookConfigRequest.WebhookURL,
	}

	payload, err := json.Marshal(newWebhookConfig)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	req, err := http.NewRequest("POST", baseURL, bytes.NewBuffer(payload))
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Failed to add webhook config",
			Data: map[string]interface{}{},
		})
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: map[string]interface{}{},
	})
}

func UpdateConfig(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Bad request",
			Data: map[string]interface{}{},
		})
		return
	}

	var webhookConfigRequest models.WebhookConfigRequest

	if err := json.NewDecoder(r.Body).Decode(&webhookConfigRequest); err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Invalid request payload",
			Data: map[string]interface{}{},
		})
		return
	}

	if !validateurl.ValidateURL(webhookConfigRequest.WebhookURL) {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "invalid URL format",
			Data: map[string]interface{}{},
		})
		return
	}

	baseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("user_id", fmt.Sprintf("eq.%s", auth.GetUserIDFromContext(r)))
	queryParams.Add("id", fmt.Sprintf("eq.%s", id))

	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	updateData := map[string]interface{}{
		"webhook_url": webhookConfigRequest.WebhookURL,
	}

	updatePayload, err := json.Marshal(updateData)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	req, err := http.NewRequest("PATCH", fullURL, bytes.NewBuffer(updatePayload))
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: map[string]interface{}{},
	})
}

func DeleteConfig(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Bad request",
			Data: map[string]interface{}{},
		})
		return
	}

	// 构建Supabase URL
	baseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("user_id", fmt.Sprintf("eq.%s", auth.GetUserIDFromContext(r)))
	queryParams.Add("id", fmt.Sprintf("eq.%s", id))
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	// 创建DELETE请求
	req, err := http.NewRequest("DELETE", fullURL, nil)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	// 设置请求头
	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	// 发送请求
	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	// 处理响应
	if resp.StatusCode != http.StatusNoContent {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	// 返回成功响应
	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: map[string]interface{}{},
	})
}

func GetConfig(w http.ResponseWriter, r *http.Request) {
	baseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("user_id", fmt.Sprintf("eq.%s", auth.GetUserIDFromContext(r)))
	queryParams.Add("limit", "1")
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	if resp.StatusCode != http.StatusOK {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	var webhook_config []tables.WebhookConfig
	err = json.Unmarshal(bodyBytes, &webhook_config)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	if len(webhook_config) == 0 {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Not found",
			Data: map[string]interface{}{},
		})
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: webhook_config[0],
	})
}

func WebhookHistory(w http.ResponseWriter, r *http.Request) {
	// 处理分页参数
	limitStr := strings.TrimSpace(r.URL.Query().Get("limit"))
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 50 {
		limit = 20
	}

	pageStr := r.URL.Query().Get("page")
	page, err := strconv.Atoi(pageStr)
	if err != nil || page <= 0 {
		page = 1
	}

	// 处理时间范围参数
	create_time_min := r.URL.Query().Get("create_time_min")
	create_time_max := r.URL.Query().Get("create_time_max")

	var createTimeMinTime, createTimeMaxTime time.Time
	if create_time_min != "" {
		createTimeMinTime, err = time.Parse("2006-01-02T15:04:05Z", create_time_min)
		if err != nil {
			http.Error(w, "Invalid create_time_min parameter", http.StatusBadRequest)
			return
		}
		createTimeMinTime = createTimeMinTime.UTC()
	}

	if create_time_max != "" {
		createTimeMaxTime, err = time.Parse("2006-01-02T15:04:05Z", create_time_max)
		if err != nil {
			http.Error(w, "Invalid create_time_max parameter", http.StatusBadRequest)
			return
		}
		createTimeMaxTime = createTimeMaxTime.UTC()
	}

	// 获取用户的所有 webhook 配置
	webhookBaseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	webhookQueryParams := url.Values{}
	webhookQueryParams.Add("select", "*")
	webhookQueryParams.Add("user_id", "eq."+auth.GetUserIDFromContext(r))

	webhookReq, err := http.NewRequest("GET", fmt.Sprintf("%s?%s", webhookBaseURL, webhookQueryParams.Encode()), nil)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  fmt.Sprintf("Failed to create webhook request: %v", err),
			Data: map[string]interface{}{},
		})
		return
	}

	webhookReq.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	webhookReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	webhookReq.Header.Set("Accept", "application/json")

	webhookResp, err := httpclient.Client.Do(webhookReq)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  fmt.Sprintf("Failed to fetch webhook config: %v", err),
			Data: map[string]interface{}{},
		})
		return
	}
	defer webhookResp.Body.Close()

	var webhookConfigs []tables.WebhookConfig
	if err := json.NewDecoder(webhookResp.Body).Decode(&webhookConfigs); err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  fmt.Sprintf("Failed to parse webhook config: %v", err),
			Data: map[string]interface{}{},
		})
		return
	}

	if len(webhookConfigs) == 0 {
		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "No webhook config found",
			Data: WebhookHistoryResponse{
				History: []tasks.SendRetry{},
				Total:   0,
			},
		})
		return
	}

	// 查询所有 webhook 的重试记录
	var allRetryHistory []tasks.SendRetry
	var wg sync.WaitGroup
	retryHistoryChan := make(chan []tasks.SendRetry)

	for _, webhookConfig := range webhookConfigs {
		wg.Add(1)
		go func(webhookConfig tables.WebhookConfig) {
			defer wg.Done()

			retryBaseURL := fmt.Sprintf("%s/rest/v1/send_retry", config.Cfg.Supabase.SupabaseUrl)
			queryParams := url.Values{}
			queryParams.Add("select", "*")
			queryParams.Add("webhook_id", "eq."+strconv.Itoa(webhookConfig.Id))

			// 添加时间范围过滤
			if !createTimeMinTime.IsZero() {
				queryParams.Add("created_at", "gte."+createTimeMinTime.Format(time.RFC3339))
			}
			if !createTimeMaxTime.IsZero() {
				queryParams.Add("created_at", "lte."+createTimeMaxTime.Format(time.RFC3339))
			}

			queryParams.Add("order", "created_at.desc")

			fullURL := fmt.Sprintf("%s?%s", retryBaseURL, queryParams.Encode())

			req, err := http.NewRequest("GET", fullURL, nil)
			if err != nil {
				// 记录错误日志
				log.Printf("Failed to create retry history request for webhook ID %d: %v", webhookConfig.Id, err)
				return
			}

			req.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
			req.Header.Set("Accept", "application/json")
			req.Header.Set("Prefer", "count=exact")

			resp, err := httpclient.Client.Do(req)
			if err != nil {
				// 记录错误日志
				log.Printf("Failed to fetch retry history for webhook ID %d: %v", webhookConfig.Id, err)
				return
			}
			defer resp.Body.Close()

			var retryHistory []tasks.SendRetry
			if err := json.NewDecoder(resp.Body).Decode(&retryHistory); err == nil {
				retryHistoryChan <- retryHistory // 将重试记录发送到 channel
			}
		}(webhookConfig) // 传递当前的 webhookConfig
	}

	// 启动一个 goroutine 来关闭 channel
	go func() {
		wg.Wait()
		close(retryHistoryChan)
	}()

	// 收集所有重试记录
	for history := range retryHistoryChan {
		allRetryHistory = append(allRetryHistory, history...)
	}

	// 实现全局分页
	start := (page - 1) * limit
	end := start + limit

	if end > len(allRetryHistory) {
		end = len(allRetryHistory)
	}

	pagedHistory := allRetryHistory[start:end]

	// 获取总数
	totalCount := len(allRetryHistory)

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: WebhookHistoryResponse{
			History: pagedHistory,
			Total:   totalCount,
		},
	})
}


func WebhookDetails(w http.ResponseWriter, r *http.Request) {
	log.Println("WebhookDetails API called")

	// 从 URL 中获取 webhook_id 参数
	webhookIDStr := strings.TrimSpace(chi.URLParam(r, "id"))
	webhookID, err := strconv.Atoi(webhookIDStr)
	if err != nil || webhookID <= 0 {
		log.Printf("Invalid webhook_id parameter: %v", webhookIDStr)
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Invalid webhook_id parameter",
			Data: nil,
		})
		return
	}
	log.Printf("Webhook ID received: %d", webhookID)

	// 获取当前登录用户的 user_id
	userID := auth.GetUserIDFromContext(r)
	log.Printf("User ID from context: %s", userID)

	// 查询用户的 webhook 配置
	log.Println("Fetching webhook configurations for the user")
	webhookBaseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	webhookQueryParams := url.Values{}
	webhookQueryParams.Add("select", "id") // 只查询 id 字段
	webhookQueryParams.Add("user_id", "eq."+userID)

	webhookReq, err := http.NewRequest("GET", fmt.Sprintf("%s?%s", webhookBaseURL, webhookQueryParams.Encode()), nil)
	if err != nil {
		log.Printf("Failed to create webhook request: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error",
			Data: nil,
		})
		return
	}
	webhookReq.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	webhookReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	webhookReq.Header.Set("Accept", "application/json")

	webhookResp, err := httpclient.Client.Do(webhookReq)
	if err != nil {
		log.Printf("Failed to fetch webhook config: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error",
			Data: nil,
		})
		return
	}
	defer webhookResp.Body.Close()

	var webhookConfigs []struct {
		Id int `json:"id"`
	}
	if err := json.NewDecoder(webhookResp.Body).Decode(&webhookConfigs); err != nil {
		log.Printf("Failed to decode webhook configs: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error",
			Data: nil,
		})
		return
	}
	log.Printf("Webhook configurations fetched: %+v", webhookConfigs)

	// 检查输入的 webhook_id 是否在用户的 webhook 配置中
	isValidWebhookID := false
	for _, config := range webhookConfigs {
		if config.Id == webhookID {
			isValidWebhookID = true
			break
		}
	}
	if !isValidWebhookID {
		log.Printf("Webhook ID %d not found in user's webhook configurations", webhookID)
		responsex.RespondWithJSON(w, http.StatusForbidden, models.Response{
			Code: http.StatusForbidden,
			Msg:  "Webhook ID not found for this user",
			Data: nil,
		})
		return
	}
	log.Printf("Webhook ID %d is valid for the user", webhookID)

	// 查询 SendRetry 表中的记录
	log.Println("Fetching retry history for the webhook ID")
	retryBaseURL := fmt.Sprintf("%s/rest/v1/send_retry", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("webhook_id", "eq."+strconv.Itoa(webhookID))
	queryParams.Add("order", "created_at.desc")

	fullURL := fmt.Sprintf("%s?%s", retryBaseURL, queryParams.Encode())
	log.Printf("SendRetry query URL: %s", fullURL)

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		log.Printf("Failed to create retry history request: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error",
			Data: nil,
		})
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Prefer", "count=exact")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		log.Printf("Failed to fetch retry history: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error",
			Data: nil,
		})
		return
	}
	defer resp.Body.Close()

	var sendRetryRecords []tasks.SendRetry
	if err := json.NewDecoder(resp.Body).Decode(&sendRetryRecords); err != nil {
		log.Printf("Failed to decode retry records: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error",
			Data: nil,
		})
		return
	}
	log.Printf("Retry history fetched for webhook ID %d: %+v", webhookID, sendRetryRecords)

	// 返回查询结果
	log.Printf("Returning retry history response for webhook ID %d", webhookID)
	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: sendRetryRecords,
	})
}


func GetWebhookStatus(w http.ResponseWriter, r *http.Request) {
	// 从 URL 获取 webhook_id
	webhookIDStr := strings.TrimSpace(chi.URLParam(r, "id"))
	webhookID, err := strconv.Atoi(webhookIDStr)
	if err != nil || webhookID <= 0 {
		log.Printf("[ERROR] Invalid webhook_id parameter: %s, error: %v", webhookIDStr, err)
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Invalid webhook_id parameter",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] Received request for webhook_id: %d", webhookID)

	// 获取当前用户的 UserID
	userID := auth.GetUserIDFromContext(r)
	if userID == "" {
		log.Printf("[ERROR] Unauthorized access: UserID not found in context")
		responsex.RespondWithJSON(w, http.StatusUnauthorized, models.Response{
			Code: http.StatusUnauthorized,
			Msg:  "Unauthorized: UserID not found",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] Current userID: %s", userID)

	// 获取当前用户的 webhook 配置
	webhookBaseURL := fmt.Sprintf("%s/rest/v1/webhook_config", config.Cfg.Supabase.SupabaseUrl)
	webhookQueryParams := url.Values{}
	webhookQueryParams.Add("select", "*")
	webhookQueryParams.Add("user_id", "eq."+userID)

	webhookReq, err := http.NewRequest("GET", fmt.Sprintf("%s?%s", webhookBaseURL, webhookQueryParams.Encode()), nil)
	if err != nil {
		log.Printf("[ERROR] Failed to create webhook request: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to create webhook request",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] Fetching webhook configs for userID: %s", userID)

	webhookReq.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	webhookReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	webhookReq.Header.Set("Accept", "application/json")

	webhookResp, err := httpclient.Client.Do(webhookReq)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch webhook config: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to fetch webhook config",
			Data: nil,
		})
		return
	}
	defer webhookResp.Body.Close()

	var webhookConfigs []tables.WebhookConfig
	if err := json.NewDecoder(webhookResp.Body).Decode(&webhookConfigs); err != nil {
		log.Printf("[ERROR] Failed to parse webhook config: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to parse webhook config",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] Retrieved %d webhook configs for userID: %s", len(webhookConfigs), userID)

	// 验证 webhook_id 是否属于当前用户
	var isAuthorized bool
	for _, webhook := range webhookConfigs {
		if webhook.Id == webhookID {
			isAuthorized = true
			break
		}
	}

	if !isAuthorized {
		log.Printf("[ERROR] Unauthorized access: webhook_id %d does not belong to userID %s", webhookID, userID)
		responsex.RespondWithJSON(w, http.StatusForbidden, models.Response{
			Code: http.StatusForbidden,
			Msg:  "Unauthorized: webhook_id does not belong to the user",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] webhook_id %d is authorized for userID: %s", webhookID, userID)

	// 查找 SendRetry 表中的状态
	retryBaseURL := fmt.Sprintf("%s/rest/v1/send_retry", config.Cfg.Supabase.SupabaseUrl)
	retryQueryParams := url.Values{}
	retryQueryParams.Add("select", "*")
	retryQueryParams.Add("webhook_id", "eq."+strconv.Itoa(webhookID))
	retryQueryParams.Add("order", "created_at.desc")

	fullURL := fmt.Sprintf("%s?%s", retryBaseURL, retryQueryParams.Encode())
	retryReq, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		log.Printf("[ERROR] Failed to create retry history request: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to create retry history request",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] Fetching retry history for webhook_id: %d", webhookID)

	retryReq.Header.Set("apikey", config.Cfg.Supabase.SupabaseApiKey)
	retryReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", auth.GetAccessTokenFromContext(r)))
	retryReq.Header.Set("Accept", "application/json")

	retryResp, err := httpclient.Client.Do(retryReq)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch retry history: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to fetch retry history",
			Data: nil,
		})
		return
	}
	defer retryResp.Body.Close()

	var sendRetries []tasks.SendRetry
	if err := json.NewDecoder(retryResp.Body).Decode(&sendRetries); err != nil {
		log.Printf("[ERROR] Failed to parse retry history: %v", err)
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to parse retry history",
			Data: nil,
		})
		return
	}
	log.Printf("[INFO] Retrieved %d retry records for webhook_id: %d", len(sendRetries), webhookID)

	// 构造精简返回数据
	statuses := make([]map[string]interface{}, len(sendRetries))
	for i, retry := range sendRetries {
		statuses[i] = map[string]interface{}{
			"webhook_id": retry.WebhookID,
			"status":     retry.Status,
		}
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: statuses,
	})
	log.Printf("[INFO] Successfully responded with retry statuses for webhook_id: %d", webhookID)
}

