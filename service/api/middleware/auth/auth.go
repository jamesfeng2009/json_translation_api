package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"json_trans_api/config"
	"json_trans_api/models/models"
	"json_trans_api/pkg/httpclient"
	responsex "json_trans_api/pkg/response"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

var UserIDContextKey = contextKey("userID")
var AccessTokenContextKey = contextKey("accessToken")

type SupabaseAPIKey struct {
	UserID string `json:"userid"`
	APIKey string `json:"apikey"`
}

var secretKey = []byte(config.Cfg.Supabase.Jwt)

func AuthApiKey() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			apiKey := r.Header.Get("jt-api-key")
			if apiKey == "" {
				responsex.RespondWithJSON(w, http.StatusUnauthorized, models.Response{
					Code: http.StatusUnauthorized,
					Msg:  "Missing API Key",
					Data: map[string]interface{}{},
				})
				return
			}

			apiKeys, err := fetchAPIKeys(apiKey)
			if err != nil {
				responsex.RespondWithJSON(w, http.StatusUnauthorized, models.Response{
					Code: http.StatusUnauthorized,
					Msg:  "API Key Validation Failed",
					Data: map[string]interface{}{},
				})
				return
			}

			if len(apiKeys) == 0 {
				responsex.RespondWithJSON(w, http.StatusUnauthorized, models.Response{
					Code: http.StatusUnauthorized,
					Msg:  "Invalid API Key",
					Data: map[string]interface{}{},
				})
				return
			}

			// 将 userID 添加到请求上下文中
			ctx := context.WithValue(r.Context(), UserIDContextKey, apiKeys[0].UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetAccessToken() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			access_token := r.Header.Get("access_token")

			token, err := jwt.Parse(access_token, func(token *jwt.Token) (interface{}, error) {
				// Don't forget to validate the alg is what you expect:
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
				}

				// hmacSampleSecret is a []byte containing your secret, e.g. []byte("my_secret_key")
				return secretKey, nil
			})
			if err != nil {
				responsex.RespondWithJSON(w, http.StatusUnauthorized, models.Response{
					Code: http.StatusUnauthorized,
					Msg:  err.Error(),
					Data: map[string]interface{}{},
				})
				return
			}

			var userid string
			if claims, ok := token.Claims.(jwt.MapClaims); ok {
				userid = claims["sub"].(string)
			} else {
				fmt.Println(err)
			}

			// 将 access_token 添加到请求上下文中
			ctx := context.WithValue(r.Context(), AccessTokenContextKey, access_token)
			ctx = context.WithValue(ctx, UserIDContextKey, userid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// fetchSupabaseAPIKeys 从 Supabase 获取 API Keys
func fetchAPIKeys(apiKey string) ([]SupabaseAPIKey, error) {
	url := config.Cfg.Supabase.SupabaseUrl + "/rest/v1/api_keys?select=*&api_key=eq." + apiKey

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var apiKeys []SupabaseAPIKey
	if err := json.NewDecoder(resp.Body).Decode(&apiKeys); err != nil {
		return nil, err
	}

	return apiKeys, nil
}

// GetUserIDFromContext 是一个辅助函数，用于从上下文中获取 userID
func GetUserIDFromContext(r *http.Request) string {
	userID, ok := r.Context().Value(UserIDContextKey).(string)
	if !ok {
		return ""
	}
	return userID
}

func GetAccessTokenFromContext(r *http.Request) string {
	access_token, ok := r.Context().Value(AccessTokenContextKey).(string)
	if !ok {
		return ""
	}
	return access_token
}
