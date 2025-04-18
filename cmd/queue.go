package cmd

import (
	"json_trans_api/service/worker"

	"github.com/spf13/cobra"
)

var queueCmd = &cobra.Command{
	Use:   "queue",
	Short: "JSON translate queue.",
	Long:  `JSON translate queue.`,
	Run: func(cmd *cobra.Command, args []string) {
		worker.Run()
	},
}

func init() {
	rootCmd.AddCommand(queueCmd)
}
