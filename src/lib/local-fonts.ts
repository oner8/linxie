import type { Font } from "fontkit";
import { GRIDS, STORAGE_KEY, restoreSettings } from "./practice";

export type LocalFont = { id: string; name: string; data: ArrayBuffer; size: number; saved: boolean };
const FILE_LIMIT = 30 * 1024 * 1024;
const TOTAL_LIMIT = 100 * 1024 * 1024;
const parsed = new Map<string, Font>();

async function fontData(data: ArrayBuffer): Promise<Font> {
  const [{ create }, { Buffer }] = await Promise.all([import("fontkit"), import("buffer")]);
  const font = create(Buffer.from(data));
  if (!("glyphForCodePoint" in font) || Object.keys(font.variationAxes || {}).length) throw new Error("请导入静态字体，暂不支持字体集合或可变字体");
  return font;
}

export async function inspectLocalFont(file: Blob, name: string, existing: LocalFont[]): Promise<LocalFont> {
  if (!file.size || file.size > FILE_LIMIT) throw new Error("字体文件需小于 30 MiB");
  const data = await file.arrayBuffer();
  const header = new DataView(data);
  if (data.byteLength < 12 || ![0x00010000, 0x4f54544f, 0x774f4646, 0x774f4632].includes(header.getUint32(0))) throw new Error("请选择有效的 TTF、OTF、WOFF 或 WOFF2 字体");
  if (!globalThis.crypto?.subtle) throw new Error("请通过 HTTPS 或本机地址打开后导入字体");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(v => v.toString(16).padStart(2, "0")).join("");
  const id = `local-${hash}`;
  const duplicate = existing.find(f => f.id === id);
  if (duplicate) return duplicate;
  if (existing.length >= 5) throw new Error("最多保存 5 款本机字体，请先删除一款");
  if (existing.reduce((sum, f) => sum + f.size, 0) + file.size > TOTAL_LIMIT) throw new Error("本机字体总量不能超过 100 MiB，请先删除旧字体");
  try { parsed.set(id, await fontData(data)); }
  catch (error) { throw new Error(error instanceof Error && error.message.startsWith("请导入") ? error.message : "无法读取这份字体，请检查文件是否完整"); }
  return { id, name: name.replace(/\.(ttf|otf|woff2?)$/i, "").slice(0, 80) || "本机字体", data, size: file.size, saved: false };
}

export async function verifyLocalText(font: LocalFont, text: string) {
  let data = parsed.get(font.id);
  if (!data) { data = await fontData(font.data); parsed.set(font.id, data); }
  const missing = [...new Set(text)].filter(c => {
    const cp = c.codePointAt(0)!;
    if (!data.hasGlyphForCodePoint(cp)) return true;
    const glyph = data.glyphForCodePoint(cp);
    return glyph.id === 0 || !glyph.path.commands.length;
  });
  if (missing.length) throw new Error(`这款字体缺少「${missing.join("、")}」，请修改文字或更换字体`);
}

function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, database = "linxie"): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("fonts", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他临写页面后重试"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("fonts", mode);
      let op: IDBRequest<T>;
      try { op = action(tx.objectStore("fonts")); }
      catch (error) { tx.abort(); db.close(); reject(error); return; }
      tx.oncomplete = () => { resolve(op.result); db.close(); };
      tx.onabort = tx.onerror = () => { reject(tx.error || op.error || new Error("本机字体存储操作失败")); db.close(); };
    };
  });
}

let migration: Promise<void> | undefined;
export function migrateLocalData(): Promise<void> {
  return migration ??= (async () => {
    let keys: string[];
    try { keys = Object.keys(localStorage); } catch { return; }
    // Discover the previous namespace from this app's versioned settings schema.
    const suffix = ".settings.v1";
    const legacyKey = keys.find(key => {
      if (key === STORAGE_KEY || !key.endsWith(suffix) || key.length <= suffix.length) return false;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return value?.version === 1 && typeof value.text === "string" && typeof value.fontId === "string" && GRIDS.some(g => g.id === value.grid);
      } catch { return false; }
    });
    if (!legacyKey) return;
    const database = legacyKey.slice(0, -suffix.length);
    const fonts = await transaction<LocalFont[]>("readonly", store => store.getAll(), database);
    await transaction("readwrite", store => {
      for (const font of fonts) {
        const add = store.add(font);
        add.onerror = event => {
          if (add.error?.name === "ConstraintError") { event.preventDefault(); event.stopPropagation(); }
        };
      }
      return store.count();
    });
    // Only retire the source after the destination transaction has committed.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("请关闭其他临写页面后重试迁移"));
    });
    if (localStorage.getItem(STORAGE_KEY) === null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreSettings(JSON.parse(localStorage.getItem(legacyKey) || "null"))));
    }
    localStorage.removeItem(legacyKey);
  })().catch(error => { migration = undefined; throw error; });
}

export async function readLocalFonts(): Promise<LocalFont[]> {
  const values = await transaction<LocalFont[]>("readonly", s => s.getAll());
  return values.filter(f => /^local-[a-f0-9]{64}$/.test(f.id) && typeof f.name === "string" && f.data instanceof ArrayBuffer && f.data.byteLength <= FILE_LIMIT).slice(0, 5).map(f => ({ ...f, size: f.data.byteLength, saved: true }));
}
export async function saveLocalFont(font: LocalFont) { await transaction("readwrite", s => s.put({ ...font, saved: true })); }
export async function deleteLocalFont(id: string, saved = true) { if (saved) await transaction("readwrite", s => s.delete(id)); parsed.delete(id); }
