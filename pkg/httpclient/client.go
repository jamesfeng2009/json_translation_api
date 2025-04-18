package httpclient

import (
	"net"
	"net/http"
	"time"
)

// Controller embeds an http.Client
// and uses it internally
type Controller struct {
	*http.Client
}

var Client Controller

func init() {
	/*
		HTTP 客户端超时的5种类型：
		Dial  TLS-handshake  Request  Resp.Header Resp.body

	*/
	client := &http.Client{
		Transport: &http.Transport{
			// 等待建立TCP连接的最长时间, 设置为3秒
			DialContext: (&net.Dialer{
				Timeout: time.Second * 3,
			}).DialContext,
			MaxIdleConnsPerHost: 50,

			// Resp.Header 等待响应头的超时时间
			ResponseHeaderTimeout: time.Second * 5,
		},
		// 每个请求的总超时时间
		Timeout: 10 * time.Second,
	}
	Client = Controller{Client: client}
}
