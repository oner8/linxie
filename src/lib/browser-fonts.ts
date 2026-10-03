import { codepointKey, type PublicFont } from "./practice";
import { verifyLocalText, type LocalFont } from "./local-fonts";

const faces = new Map<string, { face: FontFace; family: string }>();
export class LoadError extends Error { constructor(message: string, public retryAfter = 0, public refreshList = false) { super(message); } }

export async function loadPracticeFont(font: PublicFont | LocalFont, text: string, signal: AbortSignal, currentFamily?: string): Promise<string> {
  const local = "data" in font;
  if (local) await verifyLocalText(font, text);
  const key = local ? font.id : `${font.id}-${font.version}-${codepointKey(text)}`;
  const previous = faces.get(key);
  if (previous) { faces.delete(key); faces.set(key, previous); return previous.family; }
  let data: ArrayBuffer;
  if (local) data = font.data;
  else {
    const response = await fetch(`/api/fonts/${font.id}/${font.version}/${codepointKey(text)}.woff2`, { signal });
    if (!response.ok) {
      const message = await response.json().catch(() => ({}));
      throw new LoadError(message.error || "字体加载失败，请重试", Math.min(60, Number(response.headers.get("retry-after")) || 0), response.status === 404);
    }
    data = await response.arrayBuffer();
  }
  signal.throwIfAborted();
  const family = `Linxie${key.replaceAll("-", "")}`;
  const face = new FontFace(family, data);
  try { await face.load(); } catch { throw new Error("浏览器无法加载这份字体，请选择其他字体"); }
  signal.throwIfAborted();
  document.fonts.add(face);
  faces.set(key, { face, family });
  for (const [id, old] of faces) {
    if (faces.size <= 16) break;
    if (old.family !== currentFamily && id !== key) { document.fonts.delete(old.face); faces.delete(id); }
  }
  return family;
}

export function forgetLocalFont(id: string) {
  const entry = faces.get(id);
  if (entry) { document.fonts.delete(entry.face); faces.delete(id); }
}
