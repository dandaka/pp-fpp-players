const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  janeiro: 1, fevereiro: 2, "março": 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/**
 * Parse a header_texts date string like "25 - 29 March 2026" or "17 March 2026"
 * into YYYY-MM-DD (start date).
 */
function parseDateFromHeader(headerTexts: string[] | undefined): string | null {
  if (!headerTexts || headerTexts.length === 0) return null;

  // The date is typically the last element
  for (let i = headerTexts.length - 1; i >= 0; i--) {
    const text = headerTexts[i].trim().toLowerCase();

    // Pattern: "25 - 29 march 2026" or "25-29 march 2026"
    const rangeMatch = text.match(/^(\d{1,2})\s*-\s*\d{1,2}\s+([\p{L}]+)\s+(\d{4})$/u);
    if (rangeMatch) {
      const day = parseInt(rangeMatch[1]);
      const month = MONTHS[rangeMatch[2]];
      const year = parseInt(rangeMatch[3]);
      if (month && day >= 1 && day <= 31 && year >= 2000) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    // Pattern: "17 march 2026"
    const singleMatch = text.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})$/u);
    if (singleMatch) {
      const day = parseInt(singleMatch[1]);
      const month = MONTHS[singleMatch[2]];
      const year = parseInt(singleMatch[3]);
      if (month && day >= 1 && day <= 31 && year >= 2000) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  return null;
}

/**
 * Normalize an info_texts date ("2021-12-26, 14:00" -> "2021-12-26")
 * or fall back to parsing header_texts.
 */
export function parseDate(infoDate: string | undefined | null, headerTexts: string[] | undefined): string | null {
  if (infoDate) {
    // Strip time suffix: "2021-12-26, 14:00" -> "2021-12-26"
    return infoDate.substring(0, 10);
  }
  return parseDateFromHeader(headerTexts);
}
