package logger

/**
 * 使用log/slog库来记录结构化日志
 */
import (
	"json_trans_api/config"
	"log"
	"log/slog"
	"os"
)

var Logger *slog.Logger
var logFile *os.File

func init() {
	level := slog.LevelError
	switch config.Cfg.Log.Level {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn":
		level = slog.LevelWarn
	}

	opts := slog.HandlerOptions{
		AddSource:   true,
		Level:       level,
		ReplaceAttr: nil,
	}

	switch config.Cfg.Log.Output {
	case "stdout":
		Logger = slog.New(slog.NewJSONHandler(os.Stdout, &opts))
	case "stderr":
		Logger = slog.New(slog.NewJSONHandler(os.Stderr, &opts))
	default:
		var err error
		if _, err = os.Stat("logs"); os.IsNotExist(err) {
			if err = os.Mkdir("logs", os.ModePerm); err != nil {
				log.Fatalf("failed to mkdir logs, error: %v", err)
			}
		}
		logFile, err = os.OpenFile("logs/scanner.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
		if err != nil {
			log.Fatalf("failed to create log file logs, error: %v", err)
		}
		Logger = slog.New(slog.NewJSONHandler(logFile, &opts))
	}
	slog.SetDefault(Logger)
}

func Close() {
	if logFile != nil {
		err := logFile.Close()
		if err != nil {
			Logger.Error("Error closing log file", "error", err.Error())
		}
	}
}
