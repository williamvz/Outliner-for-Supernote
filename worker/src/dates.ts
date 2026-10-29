/**
 * Tana's MCP renders dates for humans ("Tomorrow", "Tue, 27 Oct",
 * "Sun, 3 Aug 2025", "Today, Thu, 29 Oct"). These helpers turn them back into
 * ISO dates relative to "today" in the user's time zone.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = `(${MONTHS.join('|')})[a-z]*\\.?`;
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})\\s+${MONTH}(?:\\s+(\\d{4}))?`, 'i');
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i');
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const RELATIVE: Record<string, number> = {yesterday: -1, today: 0, tomorrow: 1};

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

function valid(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseTanaDate(raw: string, today: string): string | null {
  // First date of a range, without HTML comments or times.
  const text = raw
    .replace(/<!--.*?-->/g, ' ')
    .split(/\s+(?:-|–|→)\s+|\//)[0]
    .trim();
  if (!text) {
    return null;
  }

  const iso = ISO.exec(text);
  if (iso) {
    return valid(+iso[1], +iso[2], +iso[3]);
  }

  const year = +today.slice(0, 4);
  const dm = DAY_MONTH.exec(text);
  if (dm) {
    return valid(dm[3] ? +dm[3] : year, MONTHS.indexOf(dm[2].toLowerCase().slice(0, 3)) + 1, +dm[1]);
  }
  const md = MONTH_DAY.exec(text);
  if (md) {
    return valid(md[3] ? +md[3] : year, MONTHS.indexOf(md[1].toLowerCase().slice(0, 3)) + 1, +md[2]);
  }

  const word = /^(yesterday|today|tomorrow)\b/i.exec(text);
  if (word) {
    return addDays(today, RELATIVE[word[1].toLowerCase()]);
  }
  return null;
}
