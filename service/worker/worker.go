package worker

import (
	"fmt"
	"json_trans_api/config"
	"json_trans_api/pkg/tasks"
	"log"

	"github.com/hibiken/asynq"
)

func Run() {
	// 记录发送队列启动的日志
	log.Println("Starting the send queue processor...")

	// 启动发送队列处理器
	tasks.StartSendQueue()

	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: fmt.Sprintf("%s:%d", config.Cfg.Redis.Host, config.Cfg.Redis.Port), Password: config.Cfg.Redis.Password},
		asynq.Config{
			// Specify how many concurrent workers to use
			Concurrency: 10,
			// Optionally specify multiple queues with different priority.
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
				"low":      1,
			},
			// See the godoc for other configuration options
		},
	)

	// mux maps a type to a handler
	mux := asynq.NewServeMux()
	mux.HandleFunc(tasks.TranslateCreate, tasks.HandleTranslateCreateTask)

	if err := srv.Run(mux); err != nil {
		log.Fatalf("could not run server: %v", err)
	}
}
