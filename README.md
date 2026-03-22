# FPP Players

Player ratings and tournament analytics for the Federacao Portuguesa de Padel (FPP).

Scrapes match data from FPP tournaments, calculates player ratings using the [OpenSkill](https://github.com/philihp/openskill.js) algorithm, and serves it through a web interface.

## Architecture

Bun monorepo with four packages:

| Package | Description |
|---------|-------------|
| `@fpp/db` | SQLite database layer |
| `@fpp/api` | Elysia REST API (port 3001) |
| `@fpp/scraper` | Playwright scraper + daemon |
| `@fpp/web` | Next.js frontend (port 3000) |

## Quick Start

```bash
bun install
bun run dev        # starts API + web concurrently
```

## Scraper

The scraper runs as a CLI or a background daemon:

```bash
bun packages/scraper/src/cli.ts scan       # discover tournaments
bun packages/scraper/src/cli.ts scrape     # scrape match data
bun packages/scraper/src/cli.ts rate       # calculate ratings
bun packages/scraper/src/cli.ts daemon     # continuous sync
```

## Docker

```bash
docker compose up
```

Runs the API and scraper as separate services with a shared SQLite volume.

## Tech Stack

- **Runtime**: Bun
- **API**: Elysia
- **Database**: SQLite (bun:sqlite)
- **Scraping**: Playwright + Cheerio
- **Ratings**: OpenSkill
- **Frontend**: Next.js, React, Tailwind CSS

## License

[MIT](LICENSE)
