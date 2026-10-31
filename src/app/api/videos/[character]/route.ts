import { validateText } from "@/lib/practice";
import { clipFor, hasVideo } from "@/lib/server/videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ character: string }> }) {
  let character: string;
  try {
    character = validateText((await params).character);
    if ([...character].length !== 1) throw new Error("请输入一个汉字");
  } catch {
    return Response.json({ error: "请输入一个汉字" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  // A character without a clip is a normal answer, not an error: the practice cell still works.
  if (!hasVideo(character)) return Response.json({ available: false }, { headers: { "Cache-Control": "public, max-age=86400" } });
  const clip = clipFor(character);
  return Response.json(
    { available: true, start: clip.start, end: clip.end, duration: clip.end - clip.start, crop: [clip.cx, clip.cy, clip.half], whole: !!clip.whole },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
