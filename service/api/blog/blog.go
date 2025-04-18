package blog

import (
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi"
)

type BlogItem struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	ImageURL  string    `json:"image_url"`
	Content   string    `json:"content"`
	Slug      string    `json:"slug"`
	Excerpt   string    `json:"excerpt"`
	CreatedAt time.Time `json:"created_at"`
}

func BlogList(w http.ResponseWriter, r *http.Request) {

	baseURL := fmt.Sprintf("%s/rest/v1/blogs", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
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
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "Failed to retrieve data", resp.StatusCode)
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to process response", http.StatusInternalServerError)
		return
	}

	var blogs []BlogItem
	err = json.Unmarshal(bodyBytes, &blogs)
	if err != nil {
		http.Error(w, "Failed to parse response data", http.StatusInternalServerError)
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: blogs,
	})

}

func BlogDetails(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimSpace(chi.URLParam(r, "id"))
	if strings.TrimSpace(idStr) == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Blog ID is required",
			Data: nil,
		})
		return
	}

	baseURL := fmt.Sprintf("%s/rest/v1/blogs", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("slug", "eq."+idStr)
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error.",
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
			Msg:  "Internal server error.",
			Data: map[string]interface{}{},
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error.",
			Data: map[string]interface{}{},
		})
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error.",
			Data: map[string]interface{}{},
		})
		return
	}

	var blogs []BlogItem
	err = json.Unmarshal(bodyBytes, &blogs)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Internal server error.",
			Data: map[string]interface{}{},
		})
		return
	}

	if len(blogs) == 0 {
		responsex.RespondWithJSON(w, http.StatusNotFound, models.Response{
			Code: http.StatusNotFound,
			Msg:  "No blog posts",
			Data: map[string]interface{}{},
		})
		return
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: blogs[0],
	})
}
