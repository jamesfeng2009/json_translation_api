package models

import (
	"time"

	"github.com/iancoleman/orderedmap"
)

type TranslationRequest struct {
	Text               []string `json:"text"`
	SourceLang         string   `json:"source_lang,omitempty"`
	TargetLang         string   `json:"target_lang"`
	SplitSentences     string   `json:"split_sentences,omitempty"`
	PreserveFormatting bool     `json:"preserve_formatting,omitempty"`
	Formality          string   `json:"formality,omitempty"`
	GlossaryId         string   `json:"glossary_id,omitempty"`
	TagHandling        string   `json:"tag_handling,omitempty"`
	OutlineDetection   bool     `json:"outline_detection,omitempty"`
}

type TranslationResponse struct {
	DetectedSourceLanguage string `json:"detected_source_language"`
	Text                   string `json:"text"`
}

type Config struct {
	SourceData     *orderedmap.OrderedMap
	TranslatedFile *orderedmap.OrderedMap
	IgnoredFields  []string
	SourceLang     string
	TargetLang     string
	APIEndpoint    string
	APIKey         string
}

type Response struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"data"`
}

type WebhookConfigRequest struct {
	WebhookURL string `json:"webhook_url"`
}

type WebhookConfig struct {
	ID         int    `json:"id"`
	UserID     string `json:"user_id"`
	WebhookURL string `json:"webhook_url"`
}

type WebhookConfigCreate struct {
	UserID     string `json:"user_id"`
	WebhookURL string `json:"webhook_url"`
}

type HistoryEntry struct {
	Timestamp    time.Time `json:"timestamp"`
	WebhookURL   string    `json:"webhook_url"`
	Status       string    `json:"status"`
	ResponseCode int       `json:"response_code"`
	Actions      []string  `json:"actions"`
	Userid       string    `json:"user_id"`
}

type Statistics struct {
	TotalRequests int     `json:"totalRequests"`
	Successful    int     `json:"successful"`
	Failed        int     `json:"failed"`
	SuccessRate   float64 `json:"successRate"`
}
