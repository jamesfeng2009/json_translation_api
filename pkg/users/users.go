package users

import (
	"encoding/json"
	"fmt"
	"io"
	"json_trans_api/config"
	"json_trans_api/models/tables"
	"json_trans_api/pkg/httpclient"
	"net/http"
	"net/url"
)

func GetUserInfo(userid string) (tables.User, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/users", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("id", "eq."+userid)
	queryParams.Add("limit", "1")
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return tables.User{}, err
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return tables.User{}, err
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		return tables.User{}, err
	}

	if resp.StatusCode != http.StatusOK {
		return tables.User{}, err
	}

	var users []tables.User
	err = json.Unmarshal(bodyBytes, &users)
	if err != nil {
		return tables.User{}, err
	}

	if len(users) == 0 {
		return tables.User{}, err
	}

	return users[0], nil
}

func GetSubscription(userid string) (tables.Subscription, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/subscriptions", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("user_id", "eq."+userid)
	queryParams.Add("order", "created.desc")
	queryParams.Add("limit", "1")
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return tables.Subscription{}, err
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return tables.Subscription{}, err
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		return tables.Subscription{}, err
	}

	if resp.StatusCode != http.StatusOK {
		return tables.Subscription{}, err
	}

	var Subscriptions []tables.Subscription
	err = json.Unmarshal(bodyBytes, &Subscriptions)
	if err != nil {
		fmt.Println(err.Error())
		return tables.Subscription{}, err
	}

	if len(Subscriptions) == 0 {
		return tables.Subscription{}, err
	}

	return Subscriptions[0], nil
}

func GetPrices(price_id string) (tables.Prices, error) {
	baseURL := fmt.Sprintf("%s/rest/v1/prices", config.Cfg.Supabase.SupabaseUrl)
	queryParams := url.Values{}
	queryParams.Add("select", "*")
	queryParams.Add("id", "eq."+price_id)
	queryParams.Add("active", "eq.TRUE")
	queryParams.Add("limit", "1")
	fullURL := fmt.Sprintf("%s?%s", baseURL, queryParams.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return tables.Prices{}, err
	}

	req.Header.Set("apikey", config.Cfg.Supabase.SupabaseSecretKey)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", config.Cfg.Supabase.SupabaseSecretKey))
	req.Header.Set("Accept", "application/json")

	resp, err := httpclient.Client.Do(req)
	if err != nil {
		return tables.Prices{}, err
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		return tables.Prices{}, err
	}

	if resp.StatusCode != http.StatusOK {
		return tables.Prices{}, err
	}

	var Prices []tables.Prices
	err = json.Unmarshal(bodyBytes, &Prices)
	if err != nil {
		return tables.Prices{}, err
	}

	if len(Prices) == 0 {
		return tables.Prices{}, err
	}

	return Prices[0], nil
}
