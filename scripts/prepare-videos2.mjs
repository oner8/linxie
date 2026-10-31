// Build per-character clips from the 7000-字 collection's comment timestamps.
// The uploader marked each character's start time in a comment; those marks lead the
// part titles (which only list what a part covers), so the comments are authoritative.
// Run with BILIBILI_SESSDATA in the environment: node scripts/prepare-videos2.mjs
import { readFile, writeFile } from "node:fs/promises";

const BV = "BV19qRCBEE9q";
const AID = "116520617320087";
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
};
const session = process.env.BILIBILI_SESSDATA?.trim();
const auth = session ? { ...headers, Cookie: `SESSDATA=${session}` } : headers;

// "94#00:00:12 镐" -> { episode: 94, seconds: 12, char: "镐" }
export function partMarks(message) {
  const out = [];
  for (const m of message.matchAll(/(\d+)#(\d{2}):(\d{2}):(\d{2})\s+(\S)/g)) {
    out.push({ episode: +m[1], seconds: +m[2] * 3600 + +m[3] * 60 + +m[4], char: m[5] });
  }
  return out;
}

async function comments() {
  if (!session) throw new Error("Set BILIBILI_SESSDATA first; anonymous paging is blocked with -352.");
  const replies = [];
  let offset = "";
  for (let page = 0; page < 30; page++) {
    const query = `type=1&oid=${AID}&mode=3&pagination_str=${encodeURIComponent(JSON.stringify({ offset }))}&plat=1&web_location=1315875`;
    const response = await fetch(`https://api.bilibili.com/x/v2/reply/main?${query}`, { headers: auth });
    const body = await response.json();
    if (body.code !== 0) throw new Error(`comment page ${page + 1}: ${body.code} ${body.message ?? ""}`);
    const batch = body.data?.replies ?? [];
    replies.push(...batch.map(c => c.content?.message ?? ""));
    const cursor = body.data?.cursor;
    if (cursor?.is_end) break;
    offset = cursor?.pagination_reply?.next_offset ?? "";
    if (!offset) break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return replies;
}

async function parts() {
  const body = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${BV}`, { headers: auth })).json();
  if (body.code !== 0) throw new Error(`view: ${body.code} ${body.message ?? ""}`);
  return body.data.pages;
}

async function main() {
    const messages = await comments();
  const pages = await parts();
  const byEpisode = new Map();
  for (const message of messages) {
    for (const mark of partMarks(message)) {
      if (!byEpisode.has(mark.episode)) byEpisode.set(mark.episode, []);
      byEpisode.get(mark.episode).push({ seconds: mark.seconds, char: mark.char });
    }
  }

  const clips = {};
  const skipped = [];
  let unused = 0;
  for (const [episode, marks] of [...byEpisode].sort((a, b) => a[0] - b[0])) {
    const page = pages[episode - 1];
    if (!page) { skipped.push(`episode ${episode}: no part`); continue; }
    const sorted = [...marks].sort((a, b) => a.seconds - b.seconds);
    sorted.forEach((mark, index) => {
      if (clips[mark.char]) { unused++; return; }
      // The mark is the stroke that starts the character; run until the next mark starts.
      // Two marks can share a second when the writer moves straight on, so keep a floor
      // rather than dropping the clip.
      const start = mark.seconds;
      const rawEnd = index + 1 < sorted.length ? sorted[index + 1].seconds : Math.min(page.duration, start + 20);
      const end = Math.max(rawEnd, start + 1);
      clips[mark.char] = { bvid: BV, cid: page.cid, start, end, part: episode };
    });
  }

  const ordered = Object.fromEntries(Object.entries(clips).sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0)));
  await writeFile(new URL("../src/lib/videos2.json", import.meta.url), JSON.stringify(ordered) + "\n");
  console.log(`comment messages=${messages.length} episodes=${byEpisode.size} clips=${Object.keys(ordered).length} duplicate=${unused} skipped=${skipped.length}`);
  if (skipped.length) console.log("skipped:", JSON.stringify(skipped.slice(0, 10)));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
