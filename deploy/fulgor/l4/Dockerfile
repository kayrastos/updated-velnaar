# Build arguments MUST be immutable digest references, for example:
# docker.io/library/node:22-bookworm-slim@sha256:...
# ghcr.io/ggml-org/llama.cpp:server-cuda@sha256:...
ARG NODE_BUILD_IMAGE
ARG LLAMA_CPP_IMAGE

FROM ${NODE_BUILD_IMAGE} AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY scripts/fulgor ./scripts/fulgor

RUN ./node_modules/.bin/esbuild \
    scripts/fulgor/cloud/l4WorkerMain.ts \
    --bundle \
    --platform=node \
    --target=node18 \
    --format=esm \
    --outfile=/out/l4-worker.mjs

FROM ${LLAMA_CPP_IMAGE}

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       nodejs \
       ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fulgor

COPY --from=build \
  /out/l4-worker.mjs \
  /opt/fulgor/l4-worker.mjs

ENV NODE_ENV=production
ENV FULGOR_L4_LLAMA_SERVER_BIN=/app/llama-server
ENV FULGOR_L4_RUNTIME_PORT=8081
ENV FULGOR_L4_CONTEXT_TOKENS=8192
ENV FULGOR_L4_MAX_OUTPUT_TOKENS=512
ENV FULGOR_L4_CPU_THREADS=4
ENV FULGOR_L4_MAX_PROMPT_BYTES=65536
ENV FULGOR_L4_INFERENCE_TIMEOUT_MS=90000

EXPOSE 8080

ENTRYPOINT ["node", "/opt/fulgor/l4-worker.mjs"]
