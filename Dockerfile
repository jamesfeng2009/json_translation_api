FROM golang:1.22.5 AS builder  
WORKDIR /app  
COPY . ./  
ENV GOPROXY https://goproxy.cn,direct
RUN go mod download  
RUN CGO_ENABLED=0 GOOS=linux go build -o main main.go
 
FROM golang:1.22.5
WORKDIR /root/  
COPY --from=builder /app/main .  

EXPOSE 80
ENTRYPOINT ["./main"]