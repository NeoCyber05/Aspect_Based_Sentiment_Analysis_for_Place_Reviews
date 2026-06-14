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

# Pin the playwright-go driver (node + package) and browser locations so the
# build-time install and the runtime library resolve the EXACT same paths,
# independent of $HOME. Without this the runtime falls back to downloading the
# driver from the CDN, and that node (wrong arch / partial) then fails to exec
# with "fork/exec .../node: no such file or directory".
ENV PLAYWRIGHT_DRIVER_PATH=/ms-playwright-go \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Pre-install the playwright driver (node) and chromium together with the OS
# libraries chromium needs. Baking these into the image avoids the runtime
# download mismatch and keeps playwright.Install() a no-op at boot. The test +
# `node --version` checks fail the build loudly if the node binary the runtime
# will exec is missing or cannot run on this image's architecture.
COPY --from=builder /playwright-cli /usr/local/bin/playwright
RUN playwright install --with-deps chromium \
    && test -x "$PLAYWRIGHT_DRIVER_PATH/node" \
    && test -f "$PLAYWRIGHT_DRIVER_PATH/package/cli.js" \
    && "$PLAYWRIGHT_DRIVER_PATH/node" --version \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /absa-backend /absa-backend

# Driver + browsers are baked in above, so the fetcher must NOT re-install them
# from the CDN per job; it should just launch the pre-installed chromium.
ENV CRAWLER_PLAYWRIGHT_PREINSTALLED=1
ENV ABSAServiceURL=http://absa:8091
ENV DataFolder=/data
ENV Addr=:8090

EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -f http://localhost:8090/api/health || exit 1

ENTRYPOINT ["/absa-backend"]
