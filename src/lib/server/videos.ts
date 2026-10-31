import clips from "../videos2.json";

// One collection only: each entry is a character's clip, start/end bracket its strokes.
// cx/cy is the writing cell centre in % of the frame; half is its half-size in the same unit.
// `whole` marks a character in a part without timestamp marks: the clip covers the part.
export type Clip = { bvid: string; cid: number; start: number; end: number; part: number; cx: number; cy: number; half: number; whole?: boolean };
const clipMap = clips as Record<string, Clip>;
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
