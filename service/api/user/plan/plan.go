package plan

import (
	"json_trans_api/models/models"
	responsex "json_trans_api/pkg/response"
	"net/http"
)

type PlanDetails struct {
	CharacterLimit int    `json:"characterLimit"`
	Support        string `json:"support"`
}

type Plan struct {
	Name           string `json:"name"`
	Price          int    `json:"price"`
	CharacterLimit int    `json:"characterLimit"`
	Support        string `json:"support"`
	Webhook        bool   `json:"webhook"`
}

func CurrentPlan(w http.ResponseWriter, r *http.Request) {
	currentSubscription := PlanDetails{
		CharacterLimit: 3000,
		Support:        "24/7",
	}

	responsex.RespondWithJSON(w, http.StatusOK, models.Response{
		Code: http.StatusOK,
		Msg:  "Success",
		Data: currentSubscription,
	})
}
