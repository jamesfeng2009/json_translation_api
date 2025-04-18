package mysql

import (
	"json_trans_api/config"
	"json_trans_api/pkg/logger"
	"log"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"xorm.io/xorm"
)

var MysqlEngine *xorm.Engine

func init() {
	var err error
	// 连接默认的数据库
	MysqlEngine, err = xorm.NewEngine("mysql", config.Cfg.Mysql.DataSourceName)
	if err != nil {
		log.Fatalf("failed to new mysql engine, error: %v", err)
	}

	MysqlEngine.SetMaxIdleConns(config.Cfg.Mysql.MaxIdleCount)
	MysqlEngine.SetMaxOpenConns(config.Cfg.Mysql.MaxOpenConns)
	MysqlEngine.SetConnMaxLifetime(time.Second * time.Duration(config.Cfg.Mysql.ConnMaxLifetime))
}

func Close() {
	err := MysqlEngine.Close()
	if err != nil {
		logger.Logger.Error("Error closing mysql engine", "error", err.Error())
	}
}

func LogStats() {
	for {
		time.Sleep(time.Minute * 1)
		logger.Logger.Info("Database connection pool stats", "stats", MysqlEngine.DB().Stats())
	}
}
