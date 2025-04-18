package rds

import (
	"context"
	"fmt"
	"json_trans_api/config"
	"json_trans_api/pkg/logger"
	"log"
	"time"

	"github.com/go-redis/redis/v8"
)

var redisClient *redis.Client

func init() {
	var err error
	redisClient := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%d", config.Cfg.Redis.Host, config.Cfg.Redis.Port),
	})

	err = redisClient.Ping(context.Background()).Err()
	if err != nil {
		log.Fatalf("failed to ping redis client, error: %v", err)
	}

}

func Close() {
	err := redisClient.Close()
	if err != nil {
		logger.Logger.Error("Error closing redis client", "error", err.Error())
	}
}

func LogStats() {
	for {
		time.Sleep(time.Minute * 1)
		logger.Logger.Info("redis client pool stats", "stats", redisClient.PoolStats())
	}
}
