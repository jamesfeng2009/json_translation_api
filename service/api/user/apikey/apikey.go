package apikey

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
	"net/http"
	"net/url"
)

func GetApiKeys(w http.ResponseWriter, r *http.Request) {
	baseURL := fmt.Sprintf("%s/rest/v1/api_keys", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
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

	if resp.StatusCode != http.StatusOK {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	var apiKeys []tables.ApiKeys
	err = json.Unmarshal(bodyBytes, &apiKeys)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Internl error",
			Data: map[string]interface{}{},
		})
		return
	}

	if len(apiKeys) == 0 {
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
		Data: apiKeys[0],
	})
}
