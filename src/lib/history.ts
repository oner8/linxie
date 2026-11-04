// Practice history lives beside the settings, on this device only: the point is to find
// yesterday's character again, and a server round trip would need an account.
export type HistoryEntry = { text: string; fontId: string; at: number; count: number };
export const HISTORY_KEY = "linxie.history.v1";
// Enough to scroll through a week of practice; older entries fall off silently.
export const HISTORY_LIMIT = 30;

const clean = (value: unknown): HistoryEntry | null => {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<HistoryEntry>;
  if (typeof entry.text !== "string" || !entry.text) return null;
  return {
    text: entry.text,
    fontId: typeof entry.fontId === "string" ? entry.fontId : "",
    at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0,
    count: typeof entry.count === "number" && entry.count >= 1 ? Math.floor(entry.count) : 1,
  };
};

export function parseHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const item of value) {
    const entry = clean(item);
    // A repeated text is one record; the newest copy wins.
    if (!entry || seen.has(entry.text)) continue;
    seen.add(entry.text);
    out.push(entry);
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

export function readHistory(): HistoryEntry[] {
  try { return parseHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || "null")); }
  catch { return []; }
}

// Writes and returns the new list, so the caller keeps one source of truth.
export function recordPractice(text: string, fontId: string): HistoryEntry[] {
  const at = Date.now();
  const current = readHistory();
  const previous = current.find(entry => entry.text === text);
  const rest = current.filter(entry => entry.text !== text);
  const next: HistoryEntry[] = [{ text, fontId, at, count: (previous?.count ?? 0) + 1 }, ...rest].slice(0, HISTORY_LIMIT);
  writeHistory(next);
  return next;
}

export function writeHistory(entries: HistoryEntry[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* Private mode: history is a convenience, not state. */ }
}

export function formatWhen(at: number, now = Date.now()): string {
  if (!at) return "";
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const date = new Date(at);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
