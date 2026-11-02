import { readFileSync } from "node:fs";

// start/end bracket the strokes of one character; cx/cy is the writing cell centre in %
// of the frame and half its half-size in the same unit. `whole` marks a character in a
// part without timestamp marks: the clip covers the whole part.
export type Clip = { bvid: string; cid: number; start: number; end: number; part: number; cx: number; cy: number; half: number; whole?: boolean };
type Part = { cid: number; cx: number; cy: number; half: number; chars: Record<string, number[]> };
type Source = { bvid: string; parts: Record<string, Part> };

// Several collections can supply characters. Order is priority: the first source to
// claim a character wins, so a newer collection only fills the gaps.
export function parseSources(data: unknown): Record<string, Clip> {
  if (!data || typeof data !== "object") return {};
  const sources = (data as { sources?: unknown }).sources;
  // Older files stored one flat map of character -> clip; keep reading them.
  if (!Array.isArray(sources)) return data as Record<string, Clip>;
  const clips: Record<string, Clip> = {};
  for (const source of sources as Source[]) {
    for (const [part, info] of Object.entries(source.parts ?? {})) {
      for (const [char, [start, end, whole]] of Object.entries(info.chars ?? {})) {
        // A character may be written in more than one collection; the first one stays.
        clips[char] ??= { bvid: source.bvid, cid: info.cid, start, end, part: Number(part), cx: info.cx, cy: info.cy, half: info.half, ...(whole ? { whole: true } : {}) };
      }
    }
  }
  return clips;
}

// The clips ship outside the image, next to the fonts. A missing file is not fatal:
// the practice cell works on its own, so the video button just stays disabled.
// One switch for the whole app: with a base set, every clip is fetched from that host;
// without it, everything goes through the proxy. Mixing the two per clip made the player
// treat a pre-cut file as if it still started at the top of the part.
const clipsBase = (process.env.LINXIE_CLIPS_BASE ?? "").trim().replace(/\/$/, "");
const clipMap = (() => {
  const file = process.env.LINXIE_VIDEO_DATA ?? "data/videos.json";
  try {
    return parseSources(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    // Deployment without the data file is a normal state; a broken one is not.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`示范视频数据无法读取（${file}）：${(error as Error).message}`);
    return {};
  }
})();
const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", Referer: "https://www.bilibili.com" };
// Play URLs carry a ~2 hour deadline; refresh before it lapses.
const lifetime = 90 * 60_000;
const streams = new Map<number, { url: string; until: number }>();

export class VideoError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export function clipFor(character: string): Clip {
  const clip = clipMap[character];
  if (!clip) throw new VideoError(404, `暂无「${character}」的示范视频`);
  return clip;
}

// Pre-cut clips are named by what they contain, so a file is shared by every character
// that plays the same span; returns null when the app is configured to proxy instead.
export function clipUrl(clip: Clip): string | null {
  if (!clipsBase) return null;
  return `${clipsBase}/${clip.cid}-${clip.start}-${clip.end}.mp4`;
}

// Whether the app serves pre-cut files rather than proxying whole parts.
export function usingClips() {
  return clipsBase !== "";
}

export function hasVideo(character: string) {
  return character in clipMap;
}

type Track = { id: number; codecid: number; width: number; height: number; baseUrl: string };
type PlayInfo = { code: number; message?: string; data?: { dash?: { video: Track[] } } };

// Video only: the practice clip needs no sound, so the separated DASH track plays as is.
// AVC is preferred because every browser decodes it; HEVC needs platform support.
function pickTrack(tracks: Track[]) {
  const playable = tracks.filter(track => track.codecid === 7);
  return (playable.length ? playable : tracks).sort((a, b) => b.id - a.id)[0];
}

async function resolve(entry: { bvid: string; cid: number }): Promise<string> {
  const cached = streams.get(entry.cid);
  if (cached && cached.until > Date.now()) return cached.url;
  const query = `bvid=${entry.bvid}&cid=${entry.cid}&fnval=4048&fourk=1`;
  const cookie = process.env.BILIBILI_SESSDATA;
  const response = await fetch(`https://api.bilibili.com/x/player/playurl?${query}`, {
    headers: cookie ? { ...headers, Cookie: `SESSDATA=${cookie}` } : headers,
  });
  const body = await response.json() as PlayInfo;
  const track = body.code === 0 && body.data?.dash ? pickTrack(body.data.dash.video) : undefined;
  if (!track) throw new VideoError(503, "视频暂时不可用，请稍后重试", 3);
  streams.set(entry.cid, { url: track.baseUrl, until: Date.now() + lifetime });
  return track.baseUrl;
}

export async function openStream(entry: { bvid: string; cid: number }, range: string | null): Promise<Response> {
  const request = async (url: string) => fetch(url, { headers: { ...headers, ...(range ? { Range: range } : {}) } });
  const upstream = await request(await resolve(entry));
  // An expired signature shows up as 403; drop it and ask for a fresh URL once.
  if (upstream.status === 403 || upstream.status === 404) {
    streams.delete(entry.cid);
    return request(await resolve(entry));
  }
  if (!upstream.ok) throw new VideoError(upstream.status === 503 ? 503 : 502, "视频暂时不可用，请稍后重试", 3);
  return upstream;
}

export function errorResponse(error: unknown) {
  const e = error instanceof VideoError ? error : new VideoError(500, "视频服务暂时不可用，请稍后重试");
  return Response.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store", ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
}
