FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY index.js ./
COPY scripts/prepare-container.cjs scripts/container-healthcheck.cjs ./scripts/
RUN AMYRAX_DATA_DIR=/opt/amyrax node scripts/prepare-container.cjs

ENV NODE_ENV=production \
    PORT=8080 \
    AMYRAX_BUNDLED_BIN_DIR=/opt/amyrax/bin

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD ["node", "scripts/container-healthcheck.cjs"]
CMD ["node", "index.js"]
