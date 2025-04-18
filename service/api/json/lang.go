package json

import (
	"encoding/json"
	"json_trans_api/config"
	"json_trans_api/models/models"
	responsex "json_trans_api/pkg/response"
	"json_trans_api/utils/translateapi"
	"net/http"
)

type Language struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type LanguagesResponse struct {
	Languages []Language `json:"languages"`
	Total     int        `json:"total"`
}

type DetectLanguageData struct {
	DetectedLangCode string `json:"detected_lang_code"`
}

func GetSupportedLanguages(w http.ResponseWriter, r *http.Request) {
	languages := make([]Language, len(config.SupportedLanguagesAli))
	for i, lang := range config.SupportedLanguagesAli {
		languages[i] = Language{
			Code: lang.Code,
			Name: lang.Name,
		}
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Languages retrieved successfully",
		Data: LanguagesResponse{
			Languages: languages,
			Total:     len(languages),
		},
	})
}

func DetectLanguage(w http.ResponseWriter, r *http.Request) {
	type DetectLanguageRequest struct {
		SourceText string `json:"source_text"`
	}

	// 解析请求体
	var req DetectLanguageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Invalid request body",
			Data: map[string]interface{}{},
		})
		return
	}

	// 验证输入是否为空
	if req.SourceText == "" {
		responsex.RespondWithJSON(w, http.StatusBadRequest, models.Response{
			Code: http.StatusBadRequest,
			Msg:  "Source text cannot be empty",
			Data: map[string]interface{}{},
		})
		return
	}

	// 调用语言检测函数
	detectedLanguage, err := translateapi.Detect(req.SourceText)
	if err != nil {
		responsex.RespondWithJSON(w, http.StatusInternalServerError, models.Response{
			Code: http.StatusInternalServerError,
			Msg:  "Language detection failed",
			Data: map[string]interface{}{},
		})
		return
	}

	responseData := DetectLanguageData{
		DetectedLangCode: detectedLanguage, // 假设返回语言代码
	}

	// 返回检测结果
	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Language detected successfully",
		Data: responseData,
	})
}
