FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /absa-backend ./cmd/server

FROM alpine:3.21

RUN apk add --no-cache ca-certificates curl

COPY --from=builder /absa-backend /absa-backend

ENV ABSAServiceURL=http://absa:8091
ENV DataFolder=/data
ENV Addr=:8090

EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -f http://localhost:8090/api/health || exit 1

ENTRYPOINT ["/absa-backend"]
