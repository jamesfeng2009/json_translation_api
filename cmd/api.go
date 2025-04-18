package cmd

import (
	"json_trans_api/service/api"

	"github.com/spf13/cobra"
)

var serverCmd = &cobra.Command{
	Use:   "api",
	Short: "JSON translate API service.",
	Long:  `JSON translate API service.`,
	Run: func(cmd *cobra.Command, args []string) {
		api.Run()
	},
}

func init() {
	rootCmd.AddCommand(serverCmd)
}
