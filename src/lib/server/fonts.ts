import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { create } from "fontkit";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isIP } from "node:net";
import { parseCodepoints, type PublicFont } from "../practice";

type FontResource = PublicFont & { file: string; coverage: string; sourceSha256?: string; raw?: boolean };
const fontDir = resolve(/* turbopackIgnore: true */ process.env.FONT_DATA_DIR || "data/fonts");
const cacheDir = resolve(/* turbopackIgnore: true */ process.env.FONT_CACHE_DIR || "data/cache");
const execute = promisify(execFile);
const limits = { bytes: 512 * 1024 * 1024, files: 20_000 };
const cached = new Map<string, { size: number; created: number }>();
const pending = new Map<string, Promise<{ bytes: Buffer; hit: boolean }>>();
let busy = false;
let initialized: Promise<void> | undefined;
let manifestPromise: Promise<FontResource[]> | undefined;
let baseHashesPromise: Promise<Set<string | undefined>> | undefined;
const scanned = new Map<string, { signature: string; font?: FontResource }>();
let scanPromise: Promise<FontResource[]> | undefined;
const fileLimit = 30 * 1024 * 1024;

export class FontError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

function baseFonts(): Promise<FontResource[]> {
  manifestPromise ??= readFile(join(/* turbopackIgnore: true */ fontDir, "manifest.json"), "utf8").then(JSON.parse).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

async function rawBytes(file: string): Promise<Buffer> {
  const handle = await open(join(/* turbopackIgnore: true */ fontDir, file), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > fileLimit) throw new Error("Invalid font file size");
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function scanFonts(): Promise<FontResource[]> {
  const base = await baseFonts();
  const files = (await readdir(/* turbopackIgnore: true */ fontDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(ttf|otf)$/i.test(entry.name) && !base.some(font => font.file === entry.name))
    .map(entry => entry.name).sort();
  for (const file of scanned.keys()) if (!files.includes(file)) scanned.delete(file);
  const fonts = [...base];
  if (files.length) baseHashesPromise ??= Promise.all(base.map(async font => createHash("sha256").update(await readFile(join(/* turbopackIgnore: true */ fontDir, font.file))).digest("hex")))
    .then(hashes => new Set([...hashes, ...base.map(font => font.sourceSha256)]))
    .catch(error => { baseHashesPromise = undefined; throw error; });
  const hashes = new Set(files.length ? await baseHashesPromise : []);
  for (const file of files) {
    try {
      const info = await lstat(join(/* turbopackIgnore: true */ fontDir, file));
      const signature = `${info.size}/${info.mtimeMs}/${info.ctimeMs}`;
      let entry = scanned.get(file);
      if (entry?.signature !== signature) {
        entry = { signature }; scanned.set(file, entry);
        if (!info.isFile() || !info.size || info.size > fileLimit) throw new Error("Invalid font file size");
        const bytes = await rawBytes(file);
        if (![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0))) throw new Error("Expected static TTF or OTF");
        for (let i = 0; i < bytes.readUInt16BE(4); i++) {
          if (bytes.toString("ascii", 12 + i * 16, 16 + i * 16) === "fvar") throw new Error("Expected static font");
        }
        const parsed = create(bytes);
        if (!("glyphForCodePoint" in parsed) || Object.keys(parsed.variationAxes || {}).length) throw new Error("Expected static font");
        const coverage = parsed.characterSet.filter(cp => {
          const glyph = parsed.glyphForCodePoint(cp);
          return cp <= 0x10ffff && glyph.id !== 0 && glyph.path.commands.length > 0;
        }).map(cp => String.fromCodePoint(cp)).join("");
        const hash = createHash("sha256").update(bytes).digest("hex");
        const name = file.replace(/\.(ttf|otf)$/i, "");
        entry.font = { id: `extra-${hash.slice(0, 32)}`, version: hash.slice(0, 24), name,
          style: ["行楷", "楷书", "行书"].find(style => name.includes(style)) || "其他", file, coverage, sourceSha256: hash, raw: true };
      }
      if (entry.font && !hashes.has(entry.font.sourceSha256)) {
        fonts.push(entry.font); hashes.add(entry.font.sourceSha256);
      }
    } catch (error) { console.warn(JSON.stringify({ event: "font_scan_skipped", file, reason: error instanceof Error ? error.message : "Invalid font" })); }
  }
  return fonts;
}

function availableFonts(): Promise<FontResource[]> {
  scanPromise ??= scanFonts().finally(() => { scanPromise = undefined; });
  return scanPromise;
}

export async function publicFonts(): Promise<PublicFont[]> {
  return (await availableFonts()).map(({ id, name, style, version }) => ({ id, name, style, version }));
}

export async function health(): Promise<void> {
  const fonts = await baseFonts();
  if (!fonts.length) throw new Error("Incomplete resources");
  await Promise.all(fonts.flatMap(f => [access(join(/* turbopackIgnore: true */ fontDir, f.file)), access(join(/* turbopackIgnore: true */ fontDir, `${f.id}.${f.version}.json`))]));
}

async function trimCache() {
  let bytes = [...cached.values()].reduce((sum, f) => sum + f.size, 0);
  if (bytes <= limits.bytes && cached.size <= limits.files) return;
  for (const [key, file] of [...cached.entries()].sort((a, b) => a[1].created - b[1].created)) {
    if (bytes <= limits.bytes * 0.8 && cached.size <= limits.files * 0.8) break;
    try { await unlink(join(/* turbopackIgnore: true */ cacheDir, key)); cached.delete(key); bytes -= file.size; }
    catch { console.warn("font_cache_cleanup_failed"); }
  }
}

async function initCache() {
  initialized ??= (async () => {
    await mkdir(cacheDir, { recursive: true });
    for (const entry of await readdir(/* turbopackIgnore: true */ cacheDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (/^[a-f0-9]{64}\.woff2$/.test(entry.name)) {
        const info = await stat(join(/* turbopackIgnore: true */ cacheDir, entry.name));
        cached.set(entry.name, { size: info.size, created: info.mtimeMs });
      } else if (/^font-[\w-]+\.tmp$/.test(entry.name)) {
        await unlink(join(/* turbopackIgnore: true */ cacheDir, entry.name));
      }
    }
    await trimCache();
  })().catch(() => { console.warn("font_cache_unavailable"); });
  return initialized;
}

async function resource(id: string, version: string): Promise<FontResource> {
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !/^[a-f0-9]{24}$/.test(version)) throw new FontError(404, "字体版本不存在，请刷新字体列表");
  const selected = (await availableFonts()).find(f => f.id === id && f.version === version);
  if (!selected) throw new FontError(404, "字体版本不存在，请刷新字体列表");
  if (selected.raw) return selected;
  try {
    const font: FontResource = JSON.parse(await readFile(join(/* turbopackIgnore: true */ fontDir, `${id}.${version}.json`), "utf8"));
    if (font.id !== id || font.version !== version || font.file !== `${id}.${version}.ttf` || typeof font.coverage !== "string") throw new Error("Invalid manifest");
    return font;
  } catch { throw new FontError(404, "字体版本不存在，请刷新字体列表"); }
}

async function generate(font: FontResource, key: string, codepoints: string) {
  const temp = await mkdtemp(join(tmpdir(), "linxie-"));
  try {
    const output = join(temp, "subset.woff2");
    let source = join(/* turbopackIgnore: true */ fontDir, font.file);
    if (font.raw) {
      const bytes = await rawBytes(font.file).catch(() => { throw new FontError(404, "字体版本不存在，请刷新字体列表"); });
      if (createHash("sha256").update(bytes).digest("hex") !== font.sourceSha256) throw new FontError(404, "字体版本不存在，请刷新字体列表");
      source = join(temp, "source" + (/\.otf$/i.test(font.file) ? ".otf" : ".ttf"));
      await writeFile(source, bytes);
    }
    try {
      await execute(process.env.PYTHON_BIN || "python3", [resolve("scripts/subset_font.py"), source, output, codepoints.replaceAll("-", ",")], { timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    } catch (error) {
      if ((error as { killed?: boolean }).killed) throw new FontError(503, "字体处理超时，请稍后重试", 2);
      throw new FontError(500, "字体处理失败，请重试或更换字体");
    }
    const bytes = await readFile(output);
    if (bytes.toString("ascii", 0, 4) !== "wOF2") throw new FontError(500, "字体数据不完整");
    const temporary = join(/* turbopackIgnore: true */ cacheDir, `font-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, join(/* turbopackIgnore: true */ cacheDir, key));
      cached.set(key, { size: bytes.length, created: Date.now() });
      await trimCache();
    } catch {
      await unlink(temporary).catch(() => undefined);
      console.warn("font_cache_write_failed");
    }
    return { bytes, hit: false };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function fontSubset(id: string, version: string, codepoints: string) {
  let text: string;
  try { text = parseCodepoints(codepoints); } catch { throw new FontError(400, "请输入 1–3 个有效汉字"); }
  const font = await resource(id, version);
  const missing = [...text].filter(c => !font.coverage.includes(c));
  if (missing.length) throw new FontError(422, `这款字体缺少「${missing.join("、")}」，请修改文字或更换字体`);
  const key = createHash("sha256").update(`${id}/${version}/${codepoints}`).digest("hex") + ".woff2";
  await initCache();
  try {
    const bytes = await readFile(join(/* turbopackIgnore: true */ cacheDir, key));
    if (bytes.toString("ascii", 0, 4) === "wOF2") return { bytes, hit: true };
  } catch { /* Cache misses can be regenerated. */ }
  const running = pending.get(key);
  if (running) return running;
  // ponytail: one worker per Node process; use a job service only if single-instance capacity is exhausted.
  if (busy) throw new FontError(503, "字体正在处理中，请稍后重试", 1);
  busy = true;
  const task = generate(font, key, codepoints).finally(() => { busy = false; pending.delete(key); });
  pending.set(key, task);
  return task;
}

const clients = new Map<string, { count: number; until: number }>();
let nextSweep = 0;
export function checkRate(request: Request) {
  const now = Date.now();
  if (now >= nextSweep) {
    for (const [key, entry] of clients) if (entry.until <= now) clients.delete(key);
    nextSweep = now + 60_000;
  }
  const candidate = process.env.TRUST_PROXY === "1" ? request.headers.get("x-real-ip") || "" : "";
  const key = isIP(candidate) ? candidate : "direct";
  let entry = clients.get(key);
  if (!entry || entry.until <= now) {
    if (!entry && clients.size >= 10_000) throw new FontError(429, "访问较多，请稍后重试", 60);
    entry = { count: 0, until: now + 60_000 }; clients.set(key, entry);
  }
  if (++entry.count > 30) throw new FontError(429, "操作有些频繁，请稍后再试", Math.max(1, Math.ceil((entry.until - now) / 1000)));
}

export function errorResponse(error: unknown) {
  const e = error instanceof FontError ? error : new FontError(500, "字体服务暂时不可用，请稍后重试");
  return Response.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store", ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
}
