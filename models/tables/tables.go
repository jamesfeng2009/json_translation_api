package tables

type ApiKeys struct {
	Id          string `json:"id"`
	Userid      string `json:"userid"`
	ApiKeyName  string `json:"apikeyname"`
	CreatedTime string `json:"create_time"`
	UpdateTime  string `json:"update_time"`
	ApiKey      string `json:"api_key"`
}

type UserJsonData struct {
	Id             string `json:"id"`
	OriginJSON     string `json:"origin_json"`
	TranslatedJSON string `json:"translated_json"`
	FromLang       string `json:"from_lang"`
	ToLang         string `json:"to_lang"`
	CreatedTime    string `json:"create_time"`
	UpdateTime     string `json:"update_time"`
	TaskID         string `json:"-"`              // 新增的 TaskID 字段
	IsTranslated   bool   `json:"-"`              // 新增的翻译状态字段
	IgnoredFields  string `json:"ignored_fields"` // 忽略翻译的字段
	CharTotal      int    `json:"char_total"`
}

type User struct {
	ID                      string `json:"id"`
	FullName                string `json:"full_name"`
	AvatarURL               string `json:"avatar_url"`
	BillingAddress          string `json:"billing_address"`
	PaymentMethod           string `json:"payment_method"`
	TotalCharactersUsed     int64  `json:"total_characters_used"`      // 使用的字符总数 (int8 类型映射为 int64)
	CharactersUsedThisMonth int64  `json:"characters_used_this_month"` // 本月使用的字符数 (int8 类型映射为 int64)
}

type WebhookConfig struct {
	Id         int    `json:"id"`
	Userid     string `json:"user_id"`
	WebhookUrl string `json:"webhook_url"`
}

// 每日的使用量
type UsageLogDaily struct {
	Id              string `json:"id"`
	Userid          string `json:"user_id"`
	TotalCharacters int64  `json:"total_characters"`
	UsageDate       string `json:"usage_date"`
}

// 用户订阅情况表
type Subscription struct {
	ID                 string                 `json:"id"`
	UserID             string                 `json:"user_id"`
	Status             string                 `json:"status"`
	Metadata           map[string]interface{} `json:"metadata"`
	PriceID            string                 `json:"price_id"`
	Quantity           int                    `json:"quantity"`
	CancelAtPeriodEnd  bool                   `json:"cancel_at_period_end"`
	Created            string                 `json:"created"`
	CurrentPeriodStart string                 `json:"current_period_start"`
	CurrentPeriodEnd   string                 `json:"current_period_end"`
	EndedAt            *string                `json:"ended_at"`
	CancelAt           *string                `json:"cancel_at"`
	CanceledAt         *string                `json:"canceled_at"`
	TrialStart         *string                `json:"trial_start"`
	TrialEnd           *string                `json:"trial_end"`
}

// 产品价格表
type Prices struct {
	ID              string                 `json:"id"`
	ProductID       string                 `json:"product_id"`
	Active          bool                   `json:"active"`
	Description     *string                `json:"description"`
	UnitAmount      int64                  `json:"unit_amount"`
	Currency        string                 `json:"currency"`
	Type            string                 `json:"type"`
	Interval        string                 `json:"interval"`
	IntervalCount   int                    `json:"interval_count"`
	TrialPeriodDays int                    `json:"trial_period_days"`
	Metadata        map[string]interface{} `json:"metadata"`
}
