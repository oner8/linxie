// Cut every clip in data/videos.json into its own MP4, so the app can serve a small
// file instead of proxying a whole part from Bilibili on every play.
//
// The clip keeps the source's 16:9 frame; the app still crops it to the practice cell
// with the crop box stored per part. Cutting the square here would make a later crop
// adjustment require a full regeneration.
//
// Files are named by cid and time so the same clip is never written twice, and existing
// files are skipped, so an interrupted run resumes where it stopped.
//
// Usage:
//   BILIBILI_SESSDATA=... node scripts/export-clips.mjs --out ./clips [--precise-only]
//                            [--limit N] [--crf 28] [--force]
//
// --crf re-encodes at that quality instead of copying; copy is lossless and needs no CPU.
// Note: the source is already around 437 kb/s, so lowering CRF raises the size and
// raising it blurs fine strokes.
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DATA = new URL("../data/videos.json", import.meta.url);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = value("out", "./clips");
const LIMIT = Number(value("limit", "0"));
const CRF = value("crf", "");
const FORCE = flag("force");
const PRECISE_ONLY = flag("precise-only");
const ONLY_CHARS = new Set((value("chars", "") || "").split("").filter(Boolean));

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
};
const session = process.env.BILIBILI_SESSDATA?.trim();
const auth = session ? { ...headers, Cookie: `SESSDATA=${session}` } : headers;

async function playUrl(cid) {
  const query = `bvid=BV19qRCBEE9q&cid=${cid}&fnval=4048&fourk=1`;
  const body = await (await fetch(`https://api.bilibili.com/x/player/playurl?${query}`, { headers: auth })).json();
  const tracks = body.data?.dash?.video ?? [];
  const track = tracks.filter(t => t.codecid === 7).sort((a, b) => b.id - a.id)[0] ?? tracks[0];
  if (!track) throw new Error(`cid ${cid}: no playable track (code ${body.code})`);
  return track.baseUrl;
}

const exists = async path => { try { await stat(path); return true; } catch { return false; } };

async function main() {
  const data = JSON.parse(await readFile(DATA, "utf8"));
  const clips = new Map();
  for (const source of data.sources) {
    for (const [part, info] of Object.entries(source.parts)) {
      for (const [char, [start, end, whole]] of Object.entries(info.chars)) {
        if (PRECISE_ONLY && whole) continue;
        if (ONLY_CHARS.size && !ONLY_CHARS.has(char)) continue;
        // Name by what the file contains, so shared whole-part clips are written once.
        const key = `${info.cid}-${start}-${end}`;
        if (!clips.has(key)) clips.set(key, { cid: info.cid, start, end, part: Number(part), whole: !!whole, chars: [] });
        clips.get(key).chars.push(char);
      }
    }
  }

  await mkdir(OUT, { recursive: true });
  const jobs = [...clips.entries()];
  const sliced = LIMIT > 0 ? jobs.slice(0, LIMIT) : jobs;
  console.log(`clips=${jobs.length} selected=${sliced.length} out=${OUT} mode=${CRF ? `crf ${CRF}` : "copy"}`);

  let made = 0, skipped = 0, failed = [], bytes = 0;
  const byCid = new Map();
  for (const [key, clip] of sliced) {
    const file = `${OUT}/${key}.mp4`;
    if (!FORCE && await exists(file)) { skipped++; bytes += (await stat(file)).size; continue; }
    try {
      // One resolve per part; hundreds of clips share a cid.
      if (!byCid.has(clip.cid)) byCid.set(clip.cid, await playUrl(clip.cid));
      const input = byCid.get(clip.cid);
      // Seeking before -i makes ffmpeg jump straight to the range instead of reading the
      // whole part, and it lands on the exact frame rather than the nearest keyframe.
      const seek = ["-ss", String(clip.start), "-to", String(clip.end), "-i", input];
      const encode = CRF
        ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", CRF, "-an"]
        : ["-c", "copy", "-an"];
      // Play URLs die after ~2h, so a long run must resolve again rather than reuse.
      // The CDN answers 403 without a bilibili Referer.
      await run(FFMPEG, [
        "-y", "-loglevel", "error",
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        "-headers", "Referer: https://www.bilibili.com\r\n",
        ...seek, ...encode, "-movflags", "+faststart", file,
      ], { timeout: 300_000 });
      made++;
      bytes += (await stat(file)).size;
      if (made % 25 === 0) console.log(`  ${made} written, ${(bytes / 1024 / 1024).toFixed(0)} MB`);
    } catch (error) {
      failed.push({ key, error: String(error.message ?? error).slice(0, 120) });
      byCid.delete(clip.cid);
    }
  }

  const manifest = {
    generated: new Date().toISOString(),
    base: value("base", ""),
    files: [...clips.keys()].map(k => `${k}.mp4`),
  };
  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(`\nwritten=${made} skipped=${skipped} failed=${failed.length} total=${(bytes / 1024 / 1024).toFixed(1)} MB`);
  if (failed.length) console.log("failed:", JSON.stringify(failed.slice(0, 8)));
}

await main();
