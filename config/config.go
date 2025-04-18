package config

import (
	"log"
	"os"

	"gopkg.in/yaml.v2"
)

var Cfg *AppConfig

type AppConfig struct {
	Elasticsearch ElasticsearchConfig `yaml:"elasticsearch"`
	Kafka         KafkaConfig         `yaml:"kafka"`
	Dev           bool                `yaml:"dev"`
	Redis         Redis               `yaml:"redis"`
	Mysql         MysqlConfig         `yaml:"mysql"`
	Log           LogConfig           `yaml:"log"`
	Foreign       bool                `yaml:"foreign"`
	Aliyun        Aliyun              `yaml:"aliyun"`
	Supabase      Supabase            `yaml:"supabase"`
}

type ElasticsearchConfig struct {
	Host              string `yaml:"host"`
	Username          string `yaml:"username"`
	Password          string `yaml:"password"`
	ScrollTimeMinutes int    `yaml:"scroll_time_minutes"`
	IndexPattern      string `yaml:"index_pattern"`
}

type KafkaConfig struct {
	Topic            string `yaml:"topic"`
	GroupId          string `yaml:"groupId"`
	BootstrapServers string `yaml:"bootstrapServers"`
	SecurityProtocol string `yaml:"securityProtocol"`
	SslCaLocation    string `yaml:"sslCaLocation"`
	SaslMechanism    string `yaml:"saslMechanism"`
	SaslUsername     string `yaml:"saslUsername"`
	SaslPassword     string `yaml:"saslPassword"`
}

type Aliyun struct {
	AccessKeyId     string `yaml:"accessKeyId"`
	AccessKeySecret string `yaml:"accessKeySecret"`
}

type Redis struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Password string `yaml:"password"`
}

type MysqlConfig struct {
	DataSourceName  string `yaml:"data_source_name"`
	MaxIdleCount    int    `yaml:"max_idle_count"`
	MaxOpenConns    int    `yaml:"max_open_conns"`
	ConnMaxLifetime int    `yaml:"conn_max_lifetime"`
}

type Supabase struct {
	SupabaseUrl       string `yaml:"supabaseUrl"`
	SupabaseApiKey    string `yaml:"supabaseApiKey"`
	SupabaseSecretKey string `yaml:"supabaseSecretKey"`
	Jwt               string `yaml:"jwt"`
}

type LogConfig struct {
	Level  string `yaml:"level"`
	Output string `yaml:"output"`
}

func init() {
	file, err := os.Open("config.yml")
	if err != nil {
		log.Fatalf("Error opening config file: %v", err)
	}
	defer func() {
		err := file.Close()
		if err != nil {
			log.Printf("Error close config file: %v", err)
		}
	}()

	Cfg = &AppConfig{}
	if err := yaml.NewDecoder(file).Decode(Cfg); err != nil {
		log.Fatalf("Error decoding config file: %v", err)
	}
}
