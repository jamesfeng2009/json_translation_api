package responsex

import (
	"encoding/json"
	"json_trans_api/models/models"
	"net/http"
)

func RespondWithJSON(w http.ResponseWriter, http_status_code int, response models.Response) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http_status_code)
	_ = json.NewEncoder(w).Encode(response)
}
