package json

import (
	"fmt"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"json_trans_api/service/api/middleware/auth"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi"
	"github.com/google/uuid"
)

func DeleteById(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusOK,
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
	queryParams.Add("id", "eq."+id)
	queryParams.Add("userid", "eq."+auth.GetUserIDFromContext(r))

	deleteURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())
	req, err := http.NewRequest("DELETE", deleteURL, nil)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Unexpected error occurred while deleting record",
			Data: map[string]interface{}{},
		})
		return
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	resp, err := httpclient.Client.Do(req)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Unexpected error occurred while deleting record",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNoContent, http.StatusOK:
		type CreateSingleData struct {
			Id string `json:"id"`
		}

		responseData := CreateSingleData{
			Id: id,
		}

		responsex.RespondWithJSON(w, http.StatusOK, models.Response{
			Code: http.StatusOK,
			Msg:  "Record deleted successfully",
			Data: responseData,
		})
		return
	case http.StatusNotFound:

		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusOK,
			Msg:  "Record not found",
			Data: map[string]interface{}{},
		})
		return
	default:
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusOK,
			Msg:  "Unexpected error occurred while deleting record",
			Data: map[string]interface{}{},
		})
		return
	}
}
