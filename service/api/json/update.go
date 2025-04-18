package json

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
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

func UpdateById(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Bad request",
			Data: map[string]interface{}{},
		})
		return
	}

	_, err := uuid.Parse(id)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Bad request",
			Data: map[string]interface{}{},
		})
		return
	}

	var updateRequest struct {
		Translation struct {
			FromLang string `json:"from_lang"`
			ToLang   string `json:"to_lang"`
		} `json:"translation"`
	}

	err = readJSON(r, &updateRequest)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Invalid request body",
			Data: map[string]interface{}{},
		})
		return
	}

	// 一般校验
	if updateRequest.Translation.FromLang == "" {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Source language is required",
			Data: map[string]interface{}{},
		})
		return
	}

	if updateRequest.Translation.ToLang == "" {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Target language is required",
			Data: map[string]interface{}{},
		})
		return
	}

	if updateRequest.Translation.ToLang == updateRequest.Translation.FromLang {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Translation requires different languages. Please choose a different source or target language.",
			Data: map[string]interface{}{},
		})

		return
	}

	// 语言支持校验
	if !config.IsLanguageSupported(updateRequest.Translation.FromLang) {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Unsupported source language",
			Data: map[string]interface{}{},
		})
		return
	}

	if !config.IsLanguageSupported(updateRequest.Translation.FromLang) {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Unsupported target language",
			Data: map[string]interface{}{},
		})
		return
	}

	userid := auth.GetUserIDFromContext(r)
	userData, err := fetchData(id, userid)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Unsupported target language",
			Data: map[string]interface{}{},
		})
		return
	}

	updateData := map[string]interface{}{
		"from_lang":   updateRequest.Translation.FromLang,
		"to_lang":     updateRequest.Translation.ToLang,
		"update_time": time.Now().UTC().Format(time.RFC3339),
	}

	updatedUser, err := performSupabaseUpdate(id, userid, updateData)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internal error",
			Data: map[string]interface{}{},
		})
		return
	}

	// 创建到翻译队列中去
	asynq_client := asynq.NewClient(asynq.RedisClientOpt{Addr: fmt.Sprintf("%s:%d", config.Cfg.Redis.Host, config.Cfg.Redis.Port), Password: config.Cfg.Redis.Password})

	defer asynq_client.Close()

	task, err := tasks.NewTranslateCreateTask(auth.GetUserIDFromContext(r), id, 0)
	if err != nil {
		log.Fatalf("could not create task: %v", err)
	}
	info, err := asynq_client.Enqueue(task)
	if err != nil {
		log.Fatalf("could not enqueue task: %v", err)
	}
	log.Printf("enqueued task: id=%s queue=%s", info.ID, info.Queue)

	responseUserJsonData := tables.UserJsonData{
		Id:             id,
		OriginJSON:     userData.OriginJSON,
		TranslatedJSON: userData.TranslatedJSON,
		FromLang:       updateRequest.Translation.FromLang,
		ToLang:         updateRequest.Translation.ToLang,
		CreatedTime:    userData.CreatedTime,
		UpdateTime:     updatedUser.UpdateTime,
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: responseUserJsonData,
	})
}

func fetchData(id string, userid string) (*tables.UserJsonData, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("id", "eq."+id)
	queryParams.Add("userid", "eq."+userid)

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

func performSupabaseUpdate(id string, userid string, updateData map[string]interface{}) (*tables.UserJsonData, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("id", "eq."+id)
	queryParams.Add("userid", "eq."+userid)
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	updatePayload, err := json.Marshal(updateData)
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

// readJSON 辅助函数，用于解析请求JSON
func readJSON(r *http.Request, dst interface{}) error {
	return json.NewDecoder(r.Body).Decode(dst)
}
