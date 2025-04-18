package json

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"json_trans_api/pkg/tasks"
	"json_trans_api/pkg/translate"
	"json_trans_api/pkg/users"
	"json_trans_api/service/api/middleware/auth"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

type UserJsonDataRequest struct {
	OriginJson    string `json:"origin_json"`
	FromLang      string `json:"from_lang"`
	ToLang        string `json:"to_lang"`
	IgnoredFields string `json:"ignored_fields"`
}

type BatchTranslationRequest struct {
	Requests []UserJsonDataRequest `json:"requests"`
}

type BatchUserJsonDataResponse struct {
	Code int               `json:"code"`
	Msg  string            `json:"msg"`
	Data []models.Response `json:"data"`
}

func CreateOne(w http.ResponseWriter, r *http.Request) {
	var requestData UserJsonDataRequest
	err := json.NewDecoder(r.Body).Decode(&requestData)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Invalid request format. Please check your request body.",
			Data: map[string]interface{}{},
		})
		return
	}

	// 参数验证
	if requestData.FromLang == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Please specify the source language.",
			Data: map[string]interface{}{},
		})
		return
	}

	if requestData.ToLang == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Please specify the target language.",
			Data: map[string]interface{}{},
		})
		return
	}

	if requestData.OriginJson == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Please provide the content to translate.",
			Data: map[string]interface{}{},
		})
		return
	}

	if requestData.FromLang == requestData.ToLang {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Source and target languages must be different. Please choose a different target language.",
			Data: map[string]interface{}{},
		})
		return
	}

	// 语言支持校验
	if !config.IsLanguageSupported(requestData.FromLang) {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "The specified source language is not supported. Please check our documentation for supported languages.",
			Data: map[string]interface{}{},
		})
		return
	}

	if !config.IsLanguageSupported(requestData.ToLang) {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "The specified target language is not supported. Please check our documentation for supported languages.",
			Data: map[string]interface{}{},
		})
		return
	}

	// JSON格式验证
	if !json.Valid([]byte(requestData.OriginJson)) {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "The provided content is not a valid JSON format. Please check and try again.",
			Data: map[string]interface{}{},
		})
		return
	}

	user_info, err := users.GetUserInfo(auth.GetUserIDFromContext(r))
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error. Please try again later.",
			Data: map[string]interface{}{},
		})
		return
	}

	// 免费用户默认是10000个字符的创建额度
	characters_max := 10000

	// 查询订阅信息
	subscription, err := users.GetSubscription(auth.GetUserIDFromContext(r))
	if err == nil {
		prices, err := users.GetPrices(subscription.PriceID)
		if err == nil {
			metadata := prices.Metadata
			character_limit_string, ok := metadata["character_limit"].(string)
			if ok {
				character_limit, _ := strconv.Atoi(character_limit_string)
				characters_max = character_limit
			}
		}
	}

	// 字符统计
	translate_config := models.Config{
		IgnoredFields: translate.GetIgnoredFields(requestData.IgnoredFields),
	}
	char_total, err := translate.CountJsonChars(requestData.OriginJson, translate_config)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Unable to process the JSON content. Please verify the format and try again.",
			Data: map[string]interface{}{},
		})
		return
	}

	// 配额检查
	if char_total+int(user_info.CharactersUsedThisMonth) > int(characters_max) {
		responsex.RespondWithJSON(w, http.StatusTooManyRequests, models.Response{
			Code: http.StatusTooManyRequests,
			Msg:  "Monthly translation quota exceeded. Please upgrade your plan or wait until the next billing cycle. Contact support for immediate assistance.",
			Data: map[string]interface{}{},
		})
		return
	}

	doc_id := uuid.New().String()
	userData := map[string]interface{}{
		"id":              doc_id,
		"userid":          auth.GetUserIDFromContext(r),
		"origin_json":     requestData.OriginJson,
		"translated_json": "",
		"from_lang":       requestData.FromLang,
		"to_lang":         requestData.ToLang,
		"char_total":      char_total,
		"create_time":     time.Now().UTC().Format(time.RFC3339),
		"update_time":     time.Now().UTC().Format(time.RFC3339),
		"ignored_fields":  requestData.IgnoredFields,
	}

	jsonData, err := json.Marshal(userData)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Unable to process your request. Please try again later.",
			Data: map[string]interface{}{},
		})
		return
	}

	supabaseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	req, err := http.NewRequest("POST", supabaseURL, bytes.NewBuffer(jsonData))
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Service temporarily unavailable. Please try again later.",
			Data: map[string]interface{}{},
		})
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Unable to save your translation request. Please try again later.",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Unable to create translation record. Please try again later.",
			Data: map[string]interface{}{},
		})
		return
	}

	task, err := tasks.NewTranslateCreateTask(auth.GetUserIDFromContext(r), doc_id, char_total)
	if err != nil {
		log.Fatalf("could not create task: %v", err)
	}

	info, err := tasks.AsynqClient.Enqueue(task)
	if err != nil {
		log.Fatalf("could not enqueue task: %v", err)
	}

	log.Printf("enqueued task: id=%s queue=%s", info.ID, info.Queue)

	type CreateSingleData struct {
		Id string `json:"id"`
	}

	responseData := CreateSingleData{
		Id: doc_id,
	}

	responsex.RespondWithJSON(w, http.StatusCreated, models.Response{
		Code: http.StatusCreated,
		Msg:  "Translation request created successfully",
		Data: responseData,
	})
}

func CreateBatch(w http.ResponseWriter, r *http.Request) {
	var batchRequest BatchTranslationRequest
	err := json.NewDecoder(r.Body).Decode(&batchRequest)
	if err != nil {
		writeBatchResponse(w, http.StatusBadRequest, "Bad request", nil)
		return
	}

	// 校验每个请求的数据
	for _, req := range batchRequest.Requests {
		if req.FromLang == "" {
			writeBatchResponse(w, http.StatusBadRequest, "Source language is required", nil)
			return
		}

		if req.ToLang == "" {
			writeBatchResponse(w, http.StatusBadRequest, "Target language is required", nil)
			return
		}

		if req.OriginJson == "" {
			writeBatchResponse(w, http.StatusBadRequest, "Translation content is missing", nil)
			return
		}

		if req.FromLang == req.ToLang {
			writeBatchResponse(w, http.StatusBadRequest, "Translation requires different languages. Please choose a different source or target language.", nil)
			return
		}

		if !config.IsLanguageSupported(req.FromLang) {
			writeBatchResponse(w, http.StatusBadRequest, "Unsupported source language", nil)
			return
		}

		if !config.IsLanguageSupported(req.ToLang) {
			writeBatchResponse(w, http.StatusBadRequest, "Unsupported target language", nil)
			return
		}

		if !json.Valid([]byte(req.OriginJson)) {
			writeBatchResponse(w, http.StatusBadRequest, "Invalid JSON String.", nil)
			return
		}
	}

	// 创建 Asynq 客户端
	asynq_client := asynq.NewClient(asynq.RedisClientOpt{
		Addr:     fmt.Sprintf("%s:%d", config.Cfg.Redis.Host, config.Cfg.Redis.Port),
		Password: config.Cfg.Redis.Password,
	})
	defer asynq_client.Close()

	var results []models.Response // 存储每个请求的结果

	for _, req := range batchRequest.Requests {
		translate_config := models.Config{
			IgnoredFields: translate.GetIgnoredFields(req.IgnoredFields),
		}
		char_total, err := translate.CountJsonChars(req.OriginJson, translate_config)
		if err != nil {
			writeBatchResponse(w, http.StatusInternalServerError, "Invalid JSON String.", nil)
			return
		}

		doc_id := uuid.New().String()
		userData := map[string]interface{}{
			"id":              doc_id,
			"userid":          auth.GetUserIDFromContext(r),
			"origin_json":     req.OriginJson,
			"translated_json": "",
			"from_lang":       req.FromLang,
			"to_lang":         req.ToLang,
		}

		jsonData, err := json.Marshal(userData)
		if err != nil {
			writeBatchResponse(w, http.StatusInternalServerError, "Failed to prepare data", nil)
			return
		}

		// 发送请求到数据库
		supabaseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
		httpReq, err := http.NewRequest("POST", supabaseURL, bytes.NewBuffer(jsonData))
		if err != nil {
			writeBatchResponse(w, http.StatusInternalServerError, "Failed to create request", nil)
			return
		}

		/*
			service role key: This key has super admin rights and can bypass your Row Level Security. Do not put it in your client-side code. Keep it private.
			If using the service role key, you'll need to pass it into both the apikey and authorization headers (again, only do this from a secure environment such as your own server)
		*/
		httpReq.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Prefer", "return=minimal")

		resp, err := httpclient.Client.Do(httpReq)
		if err != nil {
			log.Printf("Supabase request error: %v", err)
			writeBatchResponse(w, http.StatusInternalServerError, "Failed to send request to Supabase", nil)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusCreated {
			bodyBytes, _ := io.ReadAll(resp.Body)
			log.Printf("Supabase response error: %s, Body: %s", resp.Status, string(bodyBytes))
			writeBatchResponse(w, http.StatusInternalServerError, "Failed to create record in Supabase", nil)
			return
		}

		// 创建翻译任务
		task, err := tasks.NewTranslateCreateTask(auth.GetUserIDFromContext(r), doc_id, char_total)
		if err != nil {
			log.Fatalf("could not create task: %v", err)
		}
		info, err := asynq_client.Enqueue(task)
		if err != nil {
			log.Fatalf("could not enqueue task: %v", err)
		}
		log.Printf("enqueued task: id=%s queue=%s", info.ID, info.Queue)

		// 添加结果到 results 列表
		results = append(results, models.Response{
			Code: http.StatusCreated,
			Msg:  "Record created successfully",
			Data: doc_id,
		})
	}

	writeBatchResponse(w, http.StatusCreated, "Records created successfully", results)
}

func writeBatchResponse(w http.ResponseWriter, code int, msg string, data []models.Response) {
	response := BatchUserJsonDataResponse{
		Code: code,
		Msg:  msg,
		Data: data,
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(response)
}
