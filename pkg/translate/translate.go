package translate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"json_trans_api/models/models"
	"json_trans_api/pkg/logger"
	"json_trans_api/utils/translateapi"
	"log"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/iancoleman/orderedmap"
)

func GetIgnoredFields(ignoredFieldsStr string) []string {
	if ignoredFieldsStr == "" {
		return []string{}
	}

	fields := strings.Split(ignoredFieldsStr, ",")
	return fields
}

func TranslateJson(json_data string, from_lang string, to_lang string, ignored_fields string) (string, error) {

	var err error

	result := orderedmap.New()
	if err := json.Unmarshal([]byte(json_data), &result); err != nil {
		return "", err
	}

	config := models.Config{
		SourceData:    result,
		SourceLang:    from_lang,
		TargetLang:    to_lang,
		IgnoredFields: GetIgnoredFields(ignored_fields),
	}

	config.TranslatedFile, err = TranslateJSON(config)
	if err != nil {
		log.Fatal(err)
	}

	// Encoding the map back to JSON
	buf := new(bytes.Buffer)
	enc := json.NewEncoder(buf)
	enc.SetEscapeHTML(false)

	if err := enc.Encode(config.TranslatedFile); err != nil {
		log.Fatal(err)
	}

	return buf.String(), nil
}

func TranslateJSON(config models.Config) (*orderedmap.OrderedMap, error) {
	translatedFile := orderedmap.New()
	keys := config.SourceData.Keys()

	for _, key := range keys {
		elem, _ := config.SourceData.Get(key)

		if isIgnored(key, config.IgnoredFields) {
			translatedFile.Set(key, elem)
			continue
		}

		translatedElem, err := translateElement(elem, config)
		if err != nil {
			log.Printf("Error translating key %s: %v", key, err)
			translatedFile.Set(key, elem)
		} else {
			translatedFile.Set(key, translatedElem)
		}
	}

	return translatedFile, nil
}

func isIgnored(key string, ignoredFields []string) bool {
	for _, ignoredKey := range ignoredFields {
		if key == ignoredKey {
			return true
		}
	}
	return false
}

func translateElement(elem interface{}, config models.Config) (interface{}, error) {
	switch v := elem.(type) {
	case *orderedmap.OrderedMap:
		return translateNestedJSON(v, config)
	case orderedmap.OrderedMap:
		return translateNestedJSON(&v, config)
	case []interface{}:
		return translateArray(v, config)
	case string:
		return translateString(v, config)
	case float64, bool:
		return v, nil
	case nil:
		return v, nil
	default:
		return nil, fmt.Errorf("unsupported type: %v", reflect.TypeOf(elem))
	}
}

func translateNestedJSON(data *orderedmap.OrderedMap, config models.Config) (*orderedmap.OrderedMap, error) {
	translatedMap := orderedmap.New()
	for _, key := range data.Keys() {
		value, _ := data.Get(key)

		if isIgnored(key, config.IgnoredFields) {
			translatedMap.Set(key, value)
			continue
		}

		translatedValue, err := translateElement(value, config)
		if err != nil {
			return nil, fmt.Errorf("error translating key %s: %v", key, err)
		}
		translatedMap.Set(key, translatedValue)
	}
	return translatedMap, nil
}

func translateArray(arr []interface{}, config models.Config) ([]interface{}, error) {
	var translatedArr []interface{}
	for _, item := range arr {
		translatedItem, err := translateElement(item, config)
		if err != nil {
			return nil, err
		}
		translatedArr = append(translatedArr, translatedItem)
	}
	return translatedArr, nil
}

func translateString(text string, config models.Config) (string, error) {
	res, err := Translate(text, config)
	if err != nil {
		logger.Logger.Error("Error with Translate", "error", err.Error())
		return text, err
	}
	return res, nil
}

var delimiters = [][]string{
	{"{", "}"},
	{"#{", "}"},
	{"[", "]"},
	{"<", ">"},
	{"<", "/>"},
}

func Translate(sourceText string, config models.Config) (string, error) {
	variablesPre := ExtractVariables(sourceText)
	var translatedText string
	translatedText, err := translateapi.Translate(config.SourceLang, config.TargetLang, sourceText)

	// 翻译遇到错误，可能是超过了QPS限制，暂时等待3秒再发起重试
	if err != nil {
		time.Sleep(3 * time.Second)
		translatedText, err := translateapi.Translate(config.SourceLang, config.TargetLang, sourceText)
		if err != nil {
			return translatedText, err
		}
	}

	if len(variablesPre) > 0 {
		variablesPost := ExtractVariables(translatedText)
		if len(variablesPost) == len(variablesPre) {
			for i, v := range variablesPost {
				translatedText = strings.Replace(translatedText, v, variablesPre[i], 1)
			}
		}
	}

	return translatedText, nil
}

// 检查是否与已处理的位置有重叠
func isOverlapping(start, end int, processed map[int]bool) bool {
	for i := start; i < end; i++ {
		if processed[i] {
			return true
		}
	}
	return false
}

func ExtractVariables(text string) []string {
	var variables []string
	processedIndexes := make(map[int]bool) // 用于记录已处理的位置

	for _, delimiter := range delimiters {
		r, err := regexp.Compile("(\\" + delimiter[0] + "+)(.+?)(\\" + delimiter[1] + "+)")
		if err != nil {
			log.Printf("Incorrect delimiters: %s %s", delimiter[0], delimiter[1])
			continue
		}

		// 使用FindAllStringIndex来获取匹配位置
		indexes := r.FindAllStringIndex(text, -1)
		for _, loc := range indexes {
			// 检查这个位置是否已经被处理过
			if !isOverlapping(loc[0], loc[1], processedIndexes) {
				match := text[loc[0]:loc[1]]
				variables = append(variables, match)
				// 标记这个范围的所有位置为已处理
				for i := loc[0]; i < loc[1]; i++ {
					processedIndexes[i] = true
				}
			}
		}
	}
	return variables
}

// CountJsonChars 统计JSON字符串中value的字符个数
func CountJsonChars(json_data string, config models.Config) (int, error) {
	result := orderedmap.New()
	if err := json.Unmarshal([]byte(json_data), &result); err != nil {
		return 0, err
	}

	count, err := countElement(result, config)
	if err != nil {
		return 0, err
	}

	return count, nil
}

// countElement 递归统计元素字符数
func countElement(elem interface{}, config models.Config) (int, error) {
	switch v := elem.(type) {
	case *orderedmap.OrderedMap:
		return countOrderedMap(v, config)
	case orderedmap.OrderedMap:
		return countOrderedMap(&v, config)
	case []interface{}:
		return countArray(v, config)
	case string:
		// 使用 utf8.RuneCountInString 正确计算字符数
		return utf8.RuneCountInString(v), nil
	case float64, bool:
		return 0, nil
	case nil:
		return 0, nil
	default:
		return 0, fmt.Errorf("unsupported type: %v", reflect.TypeOf(elem))
	}
}

// countOrderedMap 统计OrderedMap中的字符数
func countOrderedMap(data *orderedmap.OrderedMap, config models.Config) (int, error) {
	totalCount := 0
	for _, key := range data.Keys() {
		value, _ := data.Get(key)

		// 忽略的字符不统计字符数量
		if isIgnored(key, config.IgnoredFields) {
			continue
		}

		count, err := countElement(value, config)
		if err != nil {
			return 0, fmt.Errorf("error counting characters for key %s: %v", key, err)
		}
		totalCount += count
	}
	return totalCount, nil
}

// countArray 统计数组中的字符数
func countArray(arr []interface{}, config models.Config) (int, error) {
	totalCount := 0
	for _, item := range arr {
		count, err := countElement(item, config)
		if err != nil {
			return 0, err
		}
		totalCount += count
	}
	return totalCount, nil
}
