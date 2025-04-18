package translate

import (
	"json_trans_api/models/models"
	"reflect"
	"testing"
)

func TestCountJsonChars(t *testing.T) {
	// 定义测试用例表
	tests := []struct {
		name    string
		json    string
		want    int
		wantErr bool
	}{
		{
			name:    "simple string",
			json:    `{"key": "value"}`,
			want:    5,
			wantErr: false,
		},
		{
			name: "multiple strings",
			json: `{  
                "name": "John",  
                "title": "Developer"  
            }`,
			want:    13,
			wantErr: false,
		},
		{
			name: "nested object",
			json: `{  
                "user": {  
                    "name": "John",  
                    "role": "admin"  
                }  
            }`,
			want:    9,
			wantErr: false,
		},
		{
			name: "array of strings",
			json: `{  
                "tags": ["tag1", "tag2", "tag3"]  
            }`,
			want:    12,
			wantErr: false,
		},
		{
			name: "mixed types",
			json: `{  
                "name": "John",  
                "age": 30,  
                "active": true,  
                "tags": ["developer", "golang"],  
                "details": {  
                    "location": "New York"  
                }  
            }`,
			want:    27,
			wantErr: false,
		},
		{
			name: "empty string values",
			json: `{  
                "name": "",  
                "description": ""  
            }`,
			want:    0,
			wantErr: false,
		},
		{
			name: "special characters",
			json: `{  
                "special": "!@#$%^&*",  
                "unicode": "你好世界"  
            }`,
			want:    12,
			wantErr: false,
		},
		{
			name:    "invalid json",
			json:    `{invalid json}`,
			want:    0,
			wantErr: true,
		},
		{
			name:    "empty json",
			json:    `{}`,
			want:    0,
			wantErr: false,
		},
		{
			name: "deep nested structure",
			json: `{  
                "level1": {  
                    "level2": {  
                        "level3": {  
                            "text": "deep value"  
                        }  
                    }  
                }  
            }`,
			want:    10,
			wantErr: false,
		},
		{
			name:    "pure number",
			json:    `{"key": 10}`,
			want:    0,
			wantErr: false,
		},
	}
	translate_config := models.Config{
		IgnoredFields: []string{},
	}
	// 执行测试用例
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CountJsonChars(tt.json, translate_config)

			// 检查错误情况
			if (err != nil) != tt.wantErr {
				t.Errorf("CountJsonChars() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			// 检查结果
			if err == nil && got != tt.want {
				t.Errorf("CountJsonChars() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestExtractVariables(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "两个花括号",
			input:    "Hello {{name}}",
			expected: []string{"{{name}}"},
		},
		{
			name:     "花括号变量",
			input:    "Hello {name}, welcome to {city}!",
			expected: []string{"{name}", "{city}"},
		},
		{
			name:     "井号变量",
			input:    "Hello #{username}, your balance is #{amount}",
			expected: []string{"#{username}", "#{amount}"},
		},
		{
			name:     "方括号变量",
			input:    "The value is [variable] and [another]",
			expected: []string{"[variable]", "[another]"},
		},
		{
			name:     "XML标签变量",
			input:    "Welcome <user/> to <location>",
			expected: []string{"<user/>", "<location>"},
		},
		{
			name:     "混合多种分隔符",
			input:    "Hello {name}, value is [count] and <tag/>",
			expected: []string{"{name}", "[count]", "<tag/>"},
		},
		{
			name:     "不完整的分隔符",
			input:    "Hello {name, welcome to city}",
			expected: []string{"{name, welcome to city}"},
		},
		{
			name:     "连续的变量",
			input:    "Contact: {firstName}{lastName}",
			expected: []string{"{firstName}", "{lastName}"},
		},
		{
			name:     "含有特殊字符的变量",
			input:    "Value is {user_name-123} and {$price}",
			expected: []string{"{user_name-123}", "{$price}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractVariables(tt.input)
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("extractVariables() = %v, want %v", got, tt.expected)
			}
		})
	}
}

// 测试边界情况
func TestExtractVariablesEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "嵌套的花括号",
			input:    "Hello {{name}}",
			expected: []string{"{{name}}"},
		},
		{
			name:     "带空格的变量",
			input:    "Hello { name }",
			expected: []string{"{ name }"},
		},
		{
			name:     "只有左分隔符",
			input:    "Hello {name",
			expected: nil,
		},
		{
			name:     "只有右分隔符",
			input:    "Hello name}",
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractVariables(tt.input)
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("extractVariables() = %v, want %v", got, tt.expected)
			}
		})
	}
}
