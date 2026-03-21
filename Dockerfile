FROM oven/bun:1.3 AS base
WORKDIR /app

# Install deps — can't use --frozen-lockfile because Docker context
# excludes web/legacy workspaces via .dockerignore
COPY package.json bun.lock ./
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/scraper/package.json packages/scraper/
RUN bun install

# Copy source
COPY packages/db packages/db
COPY packages/api packages/api
COPY packages/scraper packages/scraper

# ── API target ────────────────────────────────────────────────────────
FROM base AS api
ENV DB_PATH=/data/padel.db
EXPOSE 3001
CMD ["bun", "packages/api/src/index.ts"]

# ── Scraper daemon target ─────────────────────────────────────────────
FROM base AS scraper-base
# Playwright needs Chromium system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
RUN bunx playwright install chromium

FROM scraper-base AS scraper
WORKDIR /app
ENV DB_PATH=/data/padel.db
CMD ["bun", "packages/scraper/src/cli.ts", "daemon"]
