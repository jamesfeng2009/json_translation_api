package api

import (
	// "encoding/json"

	"json_trans_api/pkg/tasks"
	"json_trans_api/service/api/blog"
	"json_trans_api/service/api/json"
	"json_trans_api/service/api/middleware/auth"
	"json_trans_api/service/api/user/apikey"
	"json_trans_api/service/api/user/plan"
	"json_trans_api/service/api/user/usage"
	"json_trans_api/service/api/user/webhook"
	"net/http"

	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/cors"
)

func Run() {
	// queue close
	defer tasks.AsynqClient.Close()

	// Router
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	// Basic CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "jt-api-key", "access_token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Route("/json", func(r chi.Router) {
		r.Route("/v1", func(r chi.Router) {
			r.Mount("/translate", V1JsonRoute())
			r.Mount("/languages", V1LangRoute())
		})
	})

	r.Route("/blog", func(r chi.Router) {
		r.Get("/", blog.BlogList)
		r.Get("/{id}", blog.BlogDetails)
	})

	// 用户相关api
	r.Route("/user", func(r chi.Router) {
		r.Use(auth.GetAccessToken())

		// webhook 相关api
		r.Route("/webhook", func(r chi.Router) {
			r.Get("/", webhook.GetConfig)
			r.Post("/", webhook.AddConfig)
			r.Put("/{id}", webhook.UpdateConfig)
			r.Delete("/{id}", webhook.DeleteConfig)

			r.Get("/history", webhook.WebhookHistory)
			r.Get("/status/{id}", webhook.GetWebhookStatus)
			r.Get("/detail/{id}", webhook.WebhookDetails)
		})

		r.Get("/api_key", apikey.GetApiKeys)
		r.Get("/usage", usage.GetCurrentUsage)
		r.Get("/usage_history", usage.GetUsageHistory)

		// 订阅计划相关api
		r.Get("/current_plan", plan.CurrentPlan)
	})

	http.ListenAndServe(":3001", r)
}

func V1JsonRoute() *chi.Mux {
	router := chi.NewRouter()
	router.Use(auth.AuthApiKey())

	// 批量翻译请求[mvp 不开放批量功能]
	// router.Post("/batch", json.CreateBatch)
	router.Post("/", json.CreateOne)
	router.Delete("/{id}", json.DeleteById)
	router.Get("/", json.GetListData)
	router.Get("/{id}", json.GetOneById)
	// router.Put("/{id}", json.UpdateById)
	return router
}

func V1LangRoute() *chi.Mux {
	router := chi.NewRouter()
	router.Use(auth.AuthApiKey())
	router.Get("/", json.GetSupportedLanguages)
	router.Post("/detect", json.DetectLanguage)

	return router
}
