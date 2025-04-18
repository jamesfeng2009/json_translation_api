package json

import (
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/models/tables"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"json_trans_api/service/api/middleware/auth"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi"
	"github.com/google/uuid"
)

type TranslationsResponse struct {
	Translations []tables.UserJsonData `json:"translations"`
	Total        int                   `json:"total"`
}

func GetOneById(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "ID is missing in the request",
			Data: map[string]interface{}{},
		})
		return
	}

	if _, err := uuid.Parse(id); err != nil {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Invalid ID format",
			Data: map[string]interface{}{},
		})
		return
	}

	baseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("id", "eq."+id)
	queryParams.Add("userid", "eq."+auth.GetUserIDFromContext(r))
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

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to fetch data from the database.",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusNotFound,
			Msg:  "Translation document not found.",
			Data: map[string]interface{}{},
		})
		return
	}

	if resp.StatusCode != http.StatusOK {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Unexpected error occurred while retrieving data.",
			Data: map[string]interface{}{},
		})
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to process the response body.",
			Data: map[string]interface{}{},
		})
		return
	}

	var userData []tables.UserJsonData
	err = json.Unmarshal(bodyBytes, &userData)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Failed to parse JSON response.",
			Data: map[string]interface{}{},
		})
		return
	}

	if len(userData) == 0 {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusNotFound,
			Msg:  "Translation document not found.",
			Data: map[string]interface{}{},
		})
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: userData[0],
	})
}

func GetListData(w http.ResponseWriter, r *http.Request) {
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

	from_lang := r.URL.Query().Get("from_lang")
	to_lang := r.URL.Query().Get("to_lang")

	create_time_min := r.URL.Query().Get("create_time_min")
	create_time_max := r.URL.Query().Get("create_time_max")
	update_time_min := r.URL.Query().Get("update_time_min")
	update_time_max := r.URL.Query().Get("update_time_max")

	var createTimeMinTime, createTimeMaxTime, updateTimeMinTime, updateTimeMaxTime time.Time
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

	if update_time_min != "" {
		updateTimeMinTime, err = time.Parse("2006-01-02T15:04:05Z", update_time_min)
		if err != nil {
			http.Error(w, "Invalid update_time_min parameter", http.StatusBadRequest)
			return
		}
		updateTimeMinTime = updateTimeMinTime.UTC()
	}

	if update_time_max != "" {
		updateTimeMaxTime, err = time.Parse("2006-01-02T15:04:05Z", update_time_max)
		if err != nil {
			http.Error(w, "Invalid update_time_max parameter", http.StatusBadRequest)
			return
		}
		updateTimeMaxTime = updateTimeMaxTime.UTC()
	}

	offset := (page - 1) * limit

	baseURL := fmt.Sprintf("%s/rest/v1/user_json_translations", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("userid", "eq."+auth.GetUserIDFromContext(r))

	if from_lang != "" {
		queryParams.Add("from_lang", "eq."+from_lang)
	}
	if to_lang != "" {
		queryParams.Add("to_lang", "eq."+to_lang)
	}

	if !createTimeMinTime.IsZero() {
		queryParams.Add("create_time", "gte."+createTimeMinTime.Format(time.RFC3339))
	}

	if !createTimeMaxTime.IsZero() {
		queryParams.Add("create_time", "lte."+createTimeMaxTime.Format(time.RFC3339))
	}

	if !updateTimeMinTime.IsZero() {
		queryParams.Add("update_time", "gte."+updateTimeMinTime.Format(time.RFC3339))
	}

	if !updateTimeMaxTime.IsZero() {
		queryParams.Add("update_time", "lte."+updateTimeMaxTime.Format(time.RFC3339))
	}

	queryParams.Add("limit", strconv.Itoa(limit))
	queryParams.Add("offset", strconv.Itoa(offset))
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		log.Printf("Failed to create GET request: %v", err)
		http.Error(w, "Failed to prepare request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Prefer", "count=exact")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		http.Error(w, "Failed to fetch data", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		http.Error(w, "Failed to retrieve data", resp.StatusCode)
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to process response", http.StatusInternalServerError)
		return
	}

	var userData []tables.UserJsonData
	err = json.Unmarshal(bodyBytes, &userData)
	if err != nil {
		http.Error(w, "Failed to parse response data", http.StatusInternalServerError)
		return
	}

	// Content-Range:0-4/30 从header中提取文档的总数
	contentRange := resp.Header.Get("Content-Range")
	parts := strings.Split(contentRange, "/")
	totalCount, err := strconv.Atoi(parts[1])
	if err != nil {
		http.Error(w, "Failed to parse response data", http.StatusInternalServerError)
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: TranslationsResponse{
			Translations: userData,
			Total:        totalCount,
		},
	})
}
