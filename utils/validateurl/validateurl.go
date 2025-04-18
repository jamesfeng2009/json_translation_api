package validateurl

import (
	"net/url"
)

func ValidateURL(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}

	if u.Host == "" {
		return false
	}

	return true
}
