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

    // Pattern: "19 november 2022 - 31 march 2023" (cross-year long-span)
    const longSpanMatch = text.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})\s*-\s*\d{1,2}\s+[\p{L}]+\s+\d{4}$/u);
    if (longSpanMatch) {
      const day = parseInt(longSpanMatch[1]);
      const month = MONTHS[longSpanMatch[2]];
      const year = parseInt(longSpanMatch[3]);
      if (month && day >= 1 && day <= 31 && year >= 2000) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    // Pattern: "13 january - 11 february 2024" (cross-month range)
    const crossMonthMatch = text.match(/^(\d{1,2})\s+([\p{L}]+)\s*-\s*\d{1,2}\s+[\p{L}]+\s+(\d{4})$/u);
    if (crossMonthMatch) {
      const day = parseInt(crossMonthMatch[1]);
      const month = MONTHS[crossMonthMatch[2]];
      const year = parseInt(crossMonthMatch[3]);
      if (month && day >= 1 && day <= 31 && year >= 2000) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    // Pattern: "25 - 29 march 2026" or "25-29 march 2026" (same-month range)
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

const SHORT_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a match date_time string like "22:30, Fri 27 Mar" or "14:00, Sat 5 Apr"
 * into ISO format "YYYY-MM-DDThh:mm:00" using the tournament date to infer the year.
 *
 * Also handles already-ISO strings like "2021-12-26, 14:00" by normalizing to ISO.
 */
export function parseMatchDateTime(raw: string | null | undefined, tournamentDate: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();

  // Already ISO-ish: "2021-12-26, 14:00" or "2021-12-26"
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:,?\s*(\d{2}:\d{2}))?/);
  if (isoMatch) {
    const date = isoMatch[1];
    const time = isoMatch[2] ?? "00:00";
    return `${date}T${time}:00`;
  }

  // Pattern: "22:30, Fri 27 Mar" or "14:00, Sat 5 Apr"
  const matchTimeDay = trimmed.match(/^(\d{1,2}:\d{2}),?\s*\w+\s+(\d{1,2})\s+(\w{3})/i);
  if (matchTimeDay) {
    const time = matchTimeDay[1];
    const day = parseInt(matchTimeDay[2]);
    const monthStr = matchTimeDay[3].toLowerCase();
    const month = SHORT_MONTHS[monthStr];

    if (month && day >= 1 && day <= 31) {
      const year = inferYear(month, day, tournamentDate);
      if (year) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}:00`;
      }
    }
  }

  // Pattern: "Fri 27 Mar" (no time)
  const matchDayOnly = trimmed.match(/^\w+\s+(\d{1,2})\s+(\w{3})/i);
  if (matchDayOnly) {
    const day = parseInt(matchDayOnly[1]);
    const monthStr = matchDayOnly[2].toLowerCase();
    const month = SHORT_MONTHS[monthStr];

    if (month && day >= 1 && day <= 31) {
      const year = inferYear(month, day, tournamentDate);
      if (year) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;
      }
    }
  }

  return null;
}

/**
 * Infer the year for a match date using the tournament's known date.
 * The match month/day should be close to the tournament date.
 */
function inferYear(month: number, day: number, tournamentDate: string | null | undefined): number | null {
  if (!tournamentDate) return null;

  const tdMatch = tournamentDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!tdMatch) return null;

  const tYear = parseInt(tdMatch[1]);
  const tMonth = parseInt(tdMatch[2]);

  // If tournament is in Dec and match is in Jan, it's next year
  // If tournament is in Jan and match is in Dec, it's previous year
  // Otherwise use the tournament year
  const monthDiff = month - tMonth;
  if (monthDiff < -6) return tYear + 1;   // e.g. tournament=Nov, match=Jan
  if (monthDiff > 6) return tYear - 1;    // e.g. tournament=Jan, match=Dec
  return tYear;
}
