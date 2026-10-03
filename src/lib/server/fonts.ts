import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isIP } from "node:net";
import { parseCodepoints, type PublicFont } from "../practice";

type FontResource = PublicFont & { file: string; coverage: string };
const fontDir = resolve(/* turbopackIgnore: true */ process.env.FONT_DATA_DIR || "data/fonts");
const cacheDir = resolve(/* turbopackIgnore: true */ process.env.FONT_CACHE_DIR || "data/cache");
const execute = promisify(execFile);
const limits = { bytes: 512 * 1024 * 1024, files: 20_000 };
const cached = new Map<string, { size: number; created: number }>();
const pending = new Map<string, Promise<{ bytes: Buffer; hit: boolean }>>();
let busy = false;
let initialized: Promise<void> | undefined;
let manifestPromise: Promise<FontResource[]> | undefined;

export class FontError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export function publicFonts(): Promise<PublicFont[]> {
  manifestPromise ??= readFile(join(/* turbopackIgnore: true */ fontDir, "manifest.json"), "utf8").then(JSON.parse).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise!.then(fonts => fonts.map(({ id, name, style, version }) => ({ id, name, style, version })));
}

export async function health(): Promise<void> {
  const fonts = await publicFonts();
  if (fonts.length !== 8) throw new Error("Incomplete resources");
  await Promise.all(fonts.map(f => access(join(/* turbopackIgnore: true */ fontDir, `${f.id}.${f.version}.ttf`))));
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
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !/^[a-f0-9]{24}$/.test(version) || !(await publicFonts()).some(f => f.id === id)) throw new FontError(404, "字体版本不存在，请刷新字体列表");
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
    try {
      await execute(process.env.PYTHON_BIN || "python3", [resolve("scripts/subset_font.py"), join(/* turbopackIgnore: true */ fontDir, font.file), output, codepoints.replaceAll("-", ",")], { timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
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
