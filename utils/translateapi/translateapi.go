package translateapi

import (
	"errors"
	"json_trans_api/config"
	"log"

	"github.com/alibabacloud-go/tea/tea"

	alimt20181012 "github.com/alibabacloud-go/alimt-20181012/v2/client"
	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	util "github.com/alibabacloud-go/tea-utils/v2/service"
)

var TranslateClient *alimt20181012.Client

func init() {
	config := &openapi.Config{
		AccessKeyId:     &config.Cfg.Aliyun.AccessKeyId,
		AccessKeySecret: &config.Cfg.Aliyun.AccessKeySecret,
	}

	var err error
	config.Endpoint = tea.String("mt.aliyuncs.com")
	TranslateClient, err = alimt20181012.NewClient(config)

	if err != nil {
		log.Fatal("init aliyun translate error.")
	}
}

func Translate(from string, to string, text string) (string, error) {
	translateGeneralRequest := &alimt20181012.TranslateGeneralRequest{
		FormatType:     tea.String("text"),
		SourceLanguage: tea.String(from),
		TargetLanguage: tea.String(to),
		SourceText:     tea.String(text),
		Scene:          tea.String("general"),
	}
	runtime := &util.RuntimeOptions{}
	result, err := TranslateClient.TranslateGeneralWithOptions(translateGeneralRequest, runtime)
	if err != nil {
		return text, err
	}

	if *result.Body.Code == 200 {
		return *result.Body.Data.Translated, nil
	}

	// 翻译失败，返回原文
	return text, errors.New(*result.Body.Message)
}

func Detect(text string) (string, error) {
	getDetectLanguageRequest := &alimt20181012.GetDetectLanguageRequest{
		SourceText: tea.String(text),
	}

	runtime := &util.RuntimeOptions{}
	result, _err := TranslateClient.GetDetectLanguageWithOptions(getDetectLanguageRequest, runtime)
	if _err != nil {
		panic(_err)
	}

	/*
		{
			"headers": {
				"access-control-allow-origin": "*",
				"access-control-expose-headers": "*",
				"connection": "keep-alive",
				"content-length": "130",
				"content-type": "application/json;charset=utf-8",
				"date": "Sun, 17 Nov 2024 04:21:35 GMT",
				"etag": "1GGkwvRNIr+lxM8EfnJcTpw0",
				"keep-alive": "timeout=25",
				"x-acs-request-id": "E2CBB919-0B12-5053-9613-93A11D7C04DB",
				"x-acs-trace-id": "63b0b9a91879cd9000c021077a560645"
			},
			"statusCode": 200,
			"body": {
				"DetectedLanguage": "zh",
				"LanguageProbabilities": "zh:0.999900;zh-tw:0.000100;",
				"RequestId": "E2CBB919-0B12-5053-9613-93A11D7C04DB"
			}
		}
	*/
	if *result.StatusCode == 200 {
		return *result.Body.DetectedLanguage, nil
	}

	return "", nil
}
