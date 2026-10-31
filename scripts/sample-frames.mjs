// Samples one frame per part of the collection to map where the writing cell sits.
// Run: BILIBILI_SESSDATA=... node scripts/sample-frames.mjs [startPart] [endPart]
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BV = "19qRCBEE9q";
const session = process.env.BILIBILI_SESSDATA?.trim();
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
  ...(session ? { Cookie: `SESSDATA=${session}` } : {}),
};

const pages = JSON.parse(await readFile("/tmp/pages.json", "utf8"));
const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? pages.length);
await mkdir("/tmp/frames", { recursive: true });

const out = [];
for (let i = from; i <= to; i++) {
  const page = pages[i - 1];
  try {
    const play = await (await fetch(`https://api.bilibili.com/x/player/playurl?bvid=BV${BV}&cid=${page.cid}&fnval=4048&fourk=1`, { headers })).json();
    const tracks = (play.data?.dash?.video ?? []).filter(t => t.codecid === 7).sort((a, b) => a.id - b.id);
    const track = tracks[0];
    if (!track) { out.push({ part: i, error: "no track" }); continue; }
    const bytes = Buffer.from(await (await fetch(track.baseUrl, { headers })).arrayBuffer());
    await writeFile(`/tmp/frames/p${String(i).padStart(3, "0")}.mp4`, bytes);
    out.push({ part: i, cid: page.cid, size: bytes.length, res: `${track.width}x${track.height}`, duration: page.duration });
    process.stderr.write(`.${i}`);
  } catch (error) {
    out.push({ part: i, error: String(error.message) });
  }
  await new Promise(r => setTimeout(r, 250));
}
await writeFile("/tmp/frames/index.json", JSON.stringify(out, null, 1));
console.log(`\nsampled ${out.length} parts, errors=${out.filter(x => x.error).length}`);
