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
import { readFile, mkdir, stat, writeFile, rm } from "node:fs/promises";
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
// Parts are network-bound; a handful in flight cuts the run to a fraction.
const JOBS = Math.max(1, Number(value("jobs", "4")));

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

// A truncated download still cuts, just into a too-short file, so the part is measured
// before any clip is written.
async function duration(file) {
  try {
    const { stderr } = await run(FFMPEG, ["-i", file], { timeout: 60_000 });
    return parseDuration(stderr);
  } catch (error) {
    return parseDuration(String(error.stderr ?? error.message ?? ""));
  }
}

function parseDuration(text) {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

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

  // Cutting straight from the CDN makes ffmpeg fetch the whole part for every clip, since
  // a fragmented MP4 has no index to seek with. Pull each part once instead and cut the
  // ~33 clips it holds from the local copy.
  const byPart = new Map();
  for (const [key, clip] of sliced) {
    if (!byPart.has(clip.cid)) byPart.set(clip.cid, []);
    byPart.get(clip.cid).push([key, clip]);
  }

  const encode = CRF
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", CRF, "-an"]
    : ["-c", "copy", "-an"];
  const headers = [
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "-headers", "Referer: https://www.bilibili.com\r\n",
  ];

  let made = 0, skipped = 0, bytes = 0, seen = 0;
  const failed = [];

  // Parts download one at a time, so the wait is network latency rather than CPU; a few
  // in flight at once is what keeps the run short.
  async function work(q) {
    for (;;) {
      const next = q.shift();
      if (!next) return;
      const [cid, list] = next;
      const todo = [];
      for (const [key, clip] of list) {
        const file = `${OUT}/${key}.mp4`;
        if (!FORCE && await exists(file)) { skipped++; bytes += (await stat(file)).size; continue; }
        todo.push([key, clip, file]);
      }
      seen += list.length;
      if (!todo.length) continue;
      const partFile = `${OUT}/.part-${cid}.mp4`;
      try {
        // A download that stops early still cuts, just into a too-short file, so the part
        // is measured first. Two tries are enough: a repeat of the same length means the
        // part really is that long and the marks past its end simply have nothing to show.
        let length = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          const url = await playUrl(cid);
          await run(FFMPEG, ["-y", "-loglevel", "error", ...headers, "-i", url, "-c", "copy", partFile], { timeout: 600_000 });
          const got = await duration(partFile);
          if (got > length) length = got;
          if (got >= Math.max(...todo.map(([, clip]) => clip.end))) break;
        }
        if (length < 1) throw new Error(`part ${cid} downloaded empty`);
        for (const [key, clip, file] of todo) {
          try {
            // -ss before -i on a local file still lands on the exact frame.
            const end = Math.min(clip.end, Math.max(clip.start + 0.5, length));
            await run(FFMPEG, ["-y", "-loglevel", "error", "-ss", String(clip.start), "-to", String(end),
              "-i", partFile, ...encode, "-movflags", "+faststart", file], { timeout: 120_000 });
            made++;
            bytes += (await stat(file)).size;
          } catch (error) {
            failed.push({ key, error: String(error.message ?? error).slice(0, 120) });
          }
        }
        console.log(`  ${seen}/${sliced.length} seen, ${made} written, ${(bytes / 1024 / 1024).toFixed(0)} MB`);
      } catch (error) {
        for (const [key] of todo) failed.push({ key, error: String(error.message ?? error).slice(0, 120) });
        console.log(`  cid ${cid} failed: ${String(error.message ?? error).slice(0, 80)}`);
      } finally {
        await rm(partFile, { force: true });
      }
    }
  }

  const queue = [...byPart.entries()];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, () => work(queue)));

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
