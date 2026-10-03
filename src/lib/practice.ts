export const GRIDS = [
  { id: "square", name: "作文格", cross: false, diagonal: false, inner: false },
  { id: "tian", name: "田字格", cross: true, diagonal: false, inner: false },
  { id: "mi", name: "米字格", cross: true, diagonal: true, inner: false },
  { id: "hui", name: "回宫格", cross: false, diagonal: false, inner: true },
  { id: "huitian", name: "回田格", cross: true, diagonal: false, inner: true },
  { id: "huimi", name: "回米格", cross: true, diagonal: true, inner: true },
] as const;
export type GridId = typeof GRIDS[number]["id"];
export const STORAGE_KEY = "linxie.settings.v1";
export const THEMES = [
  { id: "paper", name: "宣纸", background: "#f7f5f0", card: "#fffefa", ink: "#242824", accent: "#b64d3d", grid: "#c9c3b9" },
  { id: "bamboo", name: "竹青", background: "#f3f6f0", card: "#fbfcf8", ink: "#233128", accent: "#4c7157", grid: "#b8c7b5" },
  { id: "celadon", name: "青瓷", background: "#eef5f4", card: "#f9fcfb", ink: "#223436", accent: "#4a787c", grid: "#adc3c1" },
  { id: "sand", name: "暖砂", background: "#f5eee4", card: "#fffbf5", ink: "#352d25", accent: "#a4774a", grid: "#cec0ae" },
  { id: "white", name: "素白", background: "#fafafa", card: "#ffffff", ink: "#202326", accent: "#59616a", grid: "#c6cbd0" },
  { id: "night", name: "夜墨", background: "#202622", card: "#28312b", ink: "#e9e3d5", accent: "#c4ac82", grid: "#556359" },
] as const;
export type ThemeId = typeof THEMES[number]["id"];
// https://z2h.cn/cizu — line/tracing palettes, checked 2026-10-02.
export const COLOR_PALETTE = [
  { name: "灰", colors: ["#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#000000"] },
  { name: "红", colors: ["#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#7f1d1d"] },
  { name: "橙", colors: ["#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412"] },
  { name: "绿", colors: ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#14532d"] },
  { name: "蓝", colors: ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e3a8a"] },
  { name: "紫", colors: ["#d8b4fe", "#c084fc", "#a855f7", "#9333ea", "#7e22ce", "#581c87"] },
] as const;
export type PracticeColor = typeof COLOR_PALETTE[number]["colors"][number] | typeof THEMES[number]["grid" | "ink"];
export type Settings = { version: 1; text: string; fontId: string; grid: GridId; theme: ThemeId; size: number; opacity: number; lineColor: PracticeColor; textColor: PracticeColor; view: "single" | "all"; wake: boolean };
export const DEFAULTS: Settings = { version: 1, text: "永", fontId: "tyz-kai", grid: "tian", theme: "paper", size: 78, opacity: 45, lineColor: "#c9c3b9", textColor: "#242824", view: "single", wake: true };
export type PublicFont = { id: string; name: string; style: string; version: string };

export function validateText(input: string): string {
  const text = input.trim();
  if (!/^[\p{Unified_Ideograph}〇]{1,3}$/u.test(text)) throw new Error("请输入 1–3 个汉字，不含空格、标点或字母");
  return text;
}

export function codepointKey(text: string): string {
  return [...new Set([...validateText(text)].map(c => c.codePointAt(0)!))].sort((a, b) => a - b).map(c => c.toString(16).toUpperCase()).join("-");
}

export function parseCodepoints(value: string): string {
  if (!/^[0-9A-F]{4,6}(?:-[0-9A-F]{4,6}){0,2}$/.test(value)) throw new Error("字符参数不合法");
  const numbers = value.split("-").map(n => parseInt(n, 16));
  if (numbers.some(n => n > 0x10ffff)) throw new Error("字符参数不合法");
  const text = validateText(String.fromCodePoint(...numbers));
  if (codepointKey(text) !== value) throw new Error("字符参数需要去重并排序");
  return text;
}

export function restoreSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") return { ...DEFAULTS };
  const s = value as Partial<Settings>;
  let text = DEFAULTS.text;
  try { if (typeof s.text === "string") text = validateText(s.text); } catch { /* Invalid saved input returns to the example. */ }
  const bounded = (v: unknown, min: number, max: number, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;
  const theme = THEMES.find(t => t.id === s.theme) || THEMES[0];
  const color = (v: unknown, fallback: PracticeColor) => COLOR_PALETTE.some(group => group.colors.some(c => c === v)) || THEMES.some(t => t.grid === v || t.ink === v) ? v as PracticeColor : fallback;
  return { version: 1, text, fontId: typeof s.fontId === "string" && /^[a-z0-9-]{1,80}$/.test(s.fontId) ? s.fontId : DEFAULTS.fontId,
    grid: GRIDS.some(g => g.id === s.grid) ? s.grid! : DEFAULTS.grid, theme: theme.id,
    size: bounded(s.size, 50, 95, DEFAULTS.size), opacity: bounded(s.opacity, 10, 100, DEFAULTS.opacity),
    lineColor: color(s.lineColor, theme.grid), textColor: color(s.textColor, theme.ink),
    view: s.view === "all" ? "all" : "single", wake: typeof s.wake === "boolean" ? s.wake : true };
}

export function swipeStep(dx: number, dy: number, milliseconds: number): number {
  return milliseconds < 800 && Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4 ? (dx < 0 ? 1 : -1) : 0;
}
