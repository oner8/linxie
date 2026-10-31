// Lists episodes without comment timestamps, with the characters each part covers,
// so they can be annotated by hand in the same "集号#时:分:秒 字" format.
// Run: BILIBILI_SESSDATA=... node scripts/missing-report.mjs
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";

const BV = "19qRCBEE9q";
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
};
const session = process.env.BILIBILI_SESSDATA?.trim();

const clips = JSON.parse(await readFile(new URL("../src/lib/videos2.json", import.meta.url), "utf8"));
const annotated = new Set(Object.values(clips).map(clip => clip.part));

const body = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=BV${BV}`, { headers: session ? { ...headers, Cookie: `SESSDATA=${session}` } : headers })).json();
if (body.code !== 0) throw new Error(`view: ${body.code} ${body.message ?? ""}`);
const pages = body.data.pages;

const lines = [];
const missing = [];
for (const page of pages) {
  if (annotated.has(page.page)) continue;
  const chars = [...page.part.replace(/^\[P\d+\]/, "")].filter(c => /\p{Unified_Ideograph}/u.test(c));
  missing.push(page.page);
  lines.push(`## 第 ${page.page} 集（${chars.length} 字，${page.duration} 秒）`);
  lines.push(`字表：${chars.join("")}`);
  lines.push("标注：");
  lines.push("");
}

const text = [
  `# 待标注清单：${missing.length} 集`,
  "",
  "格式：`集号#时:分:秒 字`，多个标注用空格分隔，例如 `101#00:00:00 永 101#00:00:12 和`。",
  "注意：标注时刻填**该字起笔的瞬间**（笔尖落纸）。",
  "",
  ...lines,
].join("\n");

await writeFile(new URL("../待标注清单.md", import.meta.url), text);
console.log(`未标注 ${missing.length} 集，已写入 待标注清单.md`);
console.log(`集号：${missing.join(",")}`);
