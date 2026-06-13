FROM golang:1.26-bookworm AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /absa-backend ./cmd/server

# Build the playwright CLI from the pinned module version so the final stage
# can install the matching driver + browser without needing Go.
RUN CGO_ENABLED=0 go build -o /playwright-cli github.com/playwright-community/playwright-go/cmd/playwright

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Pre-install the playwright driver (node) and chromium together with the OS
# libraries chromium needs. Baking these into the image avoids the runtime
# glibc/musl download mismatch and makes playwright.Install() a no-op at boot.
COPY --from=builder /playwright-cli /usr/local/bin/playwright
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /absa-backend /absa-backend

ENV ABSAServiceURL=http://absa:8091
ENV DataFolder=/data
ENV Addr=:8090

EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -f http://localhost:8090/api/health || exit 1

ENTRYPOINT ["/absa-backend"]
