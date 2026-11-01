// Local annotation server: serves the page, proxies the video stream, writes clips back.
// The Bilibili CDN rejects requests without a bilibili Referer, so the browser cannot
// fetch it directly; play URLs also expire after ~2h, hence a fresh resolve per request.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
const DATA = new URL("data/videos.json", ROOT);
const PAGES = new URL("data/annotations/pages.json", ROOT);
const PORT = Number(process.env.PORT ?? 8080);

const BV = "BV19qRCBEE9q";
const session = process.env.BILIBILI_SESSDATA?.trim();
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
  ...(session ? { Cookie: `SESSDATA=${session}` } : {}),
};

// Parts change rarely; keep the play URLs only briefly since they carry a deadline.
const streams = new Map();
const LIFETIME = 80 * 60_000;

async function pages() {
  try {
    return JSON.parse(await readFile(PAGES, "utf8"));
  } catch {
    // First run: fetch once and cache, so later runs work without a cookie.
    const body = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${BV}`, { headers })).json();
    if (body.code !== 0) throw new Error(`view ${body.code} ${body.message ?? ""}`);
    const list = body.data.pages;
    await writeFile(PAGES, JSON.stringify(list));
    return list;
  }
}

async function streamUrl(cid) {
  const hit = streams.get(cid);
  if (hit && hit.until > Date.now()) return hit.url;
  const query = `bvid=${BV}&cid=${cid}&fnval=4048&fourk=1`;
  const body = await (await fetch(`https://api.bilibili.com/x/player/playurl?${query}`, { headers })).json();
  const tracks = body.data?.dash?.video ?? [];
  // AVC decodes everywhere; the highest id is the best rendition of it.
  const track = tracks.filter(t => t.codecid === 7).sort((a, b) => b.id - a.id)[0] ?? tracks[0];
  if (!track) throw new Error("no playable track");
  streams.set(cid, { url: track.baseUrl, until: Date.now() + LIFETIME });
  return track.baseUrl;
}

// The page needs the write order of characters; the file stores them by code point,
// so the part title (which lists them in writing order) is the source of truth.
function charsInOrder(page) {
  // pages.json calls the part title `part`.
  const listed = [...(page.part ?? "").replace(/^\[P\d+\]/, "")].filter(ch => /\p{Unified_Ideograph}/u.test(ch));
  return [...new Set(listed)];
}

async function state() {
  const clips = JSON.parse(await readFile(DATA, "utf8"));
  const source = clips.sources.find(entry => entry.bvid === BV);
  const list = await pages();
  return list.map(page => {
    const info = source?.parts?.[page.page];
    const marks = {};
    for (const [char, [start, end, whole]] of Object.entries(info?.chars ?? {})) marks[char] = { start, end, whole: !!whole };
    const ordered = charsInOrder(page);
    // Characters exist only if a crop box was measured, so fall back to the file's keys.
    const chars = ordered.length ? ordered : Object.keys(info?.chars ?? {});
    return {
      page: page.page, cid: page.cid, duration: page.duration,
      chars, marks,
      crop: info ? { cx: info.cx, cy: info.cy, half: info.half } : null,
    };
  });
}

async function save(body) {
  const { page, crop, marks, whole } = JSON.parse(body);
  const clips = JSON.parse(await readFile(DATA, "utf8"));
  let source = clips.sources.find(entry => entry.bvid === BV);
  if (!source) { source = { bvid: BV, parts: {} }; clips.sources.push(source); }
  const info = source.parts[page] ??= { cid: 0, cx: 50, cy: 50, half: 40, chars: {} };
  const list = await pages();
  info.cid = list.find(p => p.page === Number(page))?.cid ?? info.cid;
  if (crop) { info.cx = crop.cx; info.cy = crop.cy; info.half = crop.half; }
  // Whole-part entries keep a single flag; marked ones carry an explicit end.
  if (whole) info.chars = Object.fromEntries(marks.map(({ char, start, end }) => [char, [start, end, 1]]));
  else for (const { char, start, end } of marks) info.chars[char] = [start, end];
  info.chars = Object.fromEntries(Object.entries(info.chars).sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0)));
  await writeFile(DATA, JSON.stringify(clips) + "\n");
}

const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript", json: "application/json; charset=utf-8" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "Content-Type": TYPES.json });
      return res.end(JSON.stringify(await state()));
    }
    if (url.pathname === "/api/save" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      await save(body);
      res.writeHead(200, { "Content-Type": TYPES.json });
      return res.end('{"ok":true}');
    }
    if (url.pathname.startsWith("/stream/")) {
      const page = Number(url.pathname.split("/")[2]);
      const list = await pages();
      const remote = await fetch(await streamUrl(list[page - 1].cid), {
        headers: { ...headers, ...(req.headers.range ? { Range: req.headers.range } : {}) },
      });
      const out = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
      for (const name of ["content-length", "content-range"]) {
        const value = remote.headers.get(name);
        if (value) out[name] = value;
      }
      res.writeHead(remote.status, out);
      for await (const chunk of remote.body) res.write(chunk);
      return res.end();
    }
    const file = url.pathname === "/" ? "/index.html" : url.pathname;
    const data = await readFile(new URL(`tools/annotate${file}`, ROOT));
    res.writeHead(200, { "Content-Type": TYPES[file.split(".").pop()] ?? "application/octet-stream" });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(error));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`标注工具：http://127.0.0.1:${PORT}`));
