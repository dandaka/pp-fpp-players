// Tournament name patterns to skip Playwright scraping (parser doesn't work for these).
// These tournaments will be retried once a better parser is implemented.
export const SKIP_PLAYWRIGHT_PATTERNS = [
  /liga\s+de\s+clubes/i,
  /campeonato\s+nacional\s+de\s+clubes/i,
  /interclubs?\s+afp/i,
];
