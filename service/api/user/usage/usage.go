package usage

import (
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/models/tables"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"json_trans_api/pkg/users"
	"json_trans_api/service/api/middleware/auth"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type Usage struct {
	TotalQuota int64 `json:"total_quota"`
	UsedQuota  int64 `json:"used_quota"`
}

type UsageData struct {
	Date      string `json:"date"`
	UsedQuota int    `json:"used_quota"`
}

type UsageMetaData struct {
	CharacterLimit int64 // 字符使用限制
}

func GetCurrentUsage(w http.ResponseWriter, r *http.Request) {
	baseURL := fmt.Sprintf("%s/rest/v1/users", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("id", "eq."+auth.GetUserIDFromContext(r))
	queryParams.Add("limit", "1")
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusBadGateway, models.Response{
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
		responsex.RespondWithJSON(w, http.StatusBadGateway, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		responsex.RespondWithJSON(w, http.StatusBadGateway, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	if err != nil {
		responsex.RespondWithJSON(w, http.StatusBadGateway, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	var users_list []tables.User
	err = json.Unmarshal(bodyBytes, &users_list)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusBadGateway, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	if len(users_list) == 0 {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Not found",
			Data: map[string]interface{}{},
		})
		return
	}

	// 免费用户默认是10k个字符的创建额度
	var characters_max int64
	characters_max = 10000

	// 查询订阅信息
	subscription, err := users.GetSubscription(auth.GetUserIDFromContext(r))
	if err == nil {

		// 当订阅是激活，或者是取消订阅的时候，判断日期是否还没有到服务终止的时候
		CurrentPeriodEnd, err := time.Parse(time.RFC3339, subscription.CurrentPeriodEnd)
		if err != nil {
			responsex.RespondWithJSON(w, http.StatusBadGateway, models.Response{
				Code: http.StatusBadGateway,
				Msg:  "Internl error",
				Data: map[string]interface{}{},
			})
			return
		}

		now := time.Now()
		if subscription.Status == "active" || now.Before(CurrentPeriodEnd) {
			prices, err := users.GetPrices(subscription.PriceID)
			if err == nil {
				metadata := prices.Metadata
				character_limit_string, ok := metadata["character_limit"].(string)
				if ok {
					character_limit, _ := strconv.Atoi(character_limit_string)
					characters_max = int64(character_limit)
				}
			}
		}
	}

	usage := Usage{
		TotalQuota: characters_max,
		UsedQuota:  users_list[0].CharactersUsedThisMonth,
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: usage,
	})
}

func GetUsageHistory(w http.ResponseWriter, r *http.Request) {
	startDateStr := r.URL.Query().Get("start_date")
	endDateStr := r.URL.Query().Get("end_date")

	var startDate, endDate time.Time
	var err error

	if startDateStr != "" {
		startDate, err = time.Parse("2006-01-02", startDateStr)
		if err != nil {
			responsex.RespondWithJSON(w, http.StatusOK, models.Response{
				Code: http.StatusOK,
				Msg:  "Invalid start_date format. Use YYYY-MM-DD.",
				Data: map[string]interface{}{},
			})
			return
		}
	}

	if endDateStr != "" {
		endDate, err = time.Parse("2006-01-02", endDateStr)
		if err != nil {
			responsex.RespondWithJSON(w, http.StatusOK, models.Response{
				Code: http.StatusOK,
				Msg:  "Invalid end_date format. Use YYYY-MM-DD.",
				Data: map[string]interface{}{},
			})
			return
		}
	}

	if !startDate.IsZero() && !endDate.IsZero() {
		if startDate.After(endDate) {
			responsex.RespondWithJSON(w, http.StatusOK, models.Response{
				Code: http.StatusOK,
				Msg:  "start_date must be before end_date.",
				Data: map[string]interface{}{},
			})
			return
		}
	}

	baseURL := fmt.Sprintf("%s/rest/v1/character_usage_log_daily", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("user_id", "eq."+auth.GetUserIDFromContext(r))

	if !startDate.IsZero() {
		queryParams.Add("usage_date", "gte."+startDate.Format(time.RFC3339))
	}

	if !endDate.IsZero() {
		queryParams.Add("usage_date", "lte."+endDate.Format(time.RFC3339))
	}

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

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		http.Error(w, "Failed to fetch data", http.StatusInternalServerError)
		return
	}
	bodyBytes, err := io.ReadAll(resp.Body)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "Failed to retrieve data", resp.StatusCode)
		return
	}

	if err != nil {
		http.Error(w, "Failed to process response", http.StatusInternalServerError)
		return
	}

	var usage_log_daily_list []tables.UsageLogDaily
	err = json.Unmarshal(bodyBytes, &usage_log_daily_list)
	if err != nil {
		http.Error(w, "Failed to parse response data", http.StatusInternalServerError)
		return
	}

	if len(usage_log_daily_list) > 0 {
		var history []UsageData
		for _, v := range usage_log_daily_list {
			history = append(history, UsageData{Date: v.UsageDate, UsedQuota: int(v.TotalCharacters)})
		}

		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Success",
			Data: history,
		})
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: map[string]interface{}{},
	})
}
