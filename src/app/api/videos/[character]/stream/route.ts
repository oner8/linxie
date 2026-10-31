import { validateText } from "@/lib/practice";
import { clipFor, errorResponse, openStream } from "@/lib/server/videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function stream(request: Request, { params }: { params: Promise<{ character: string }> }) {
  let character: string;
  try {
    character = validateText((await params).character);
    if ([...character].length !== 1) throw new Error("请输入一个汉字");
  } catch {
    return Response.json({ error: "请输入一个汉字" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    // The player seeks inside the part with Range; only the clip's seconds are fetched.
    const upstream = await openStream(clipFor(character), request.headers.get("range"));
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, max-age=0", "Accept-Ranges": "bytes" });
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  } catch (error) { return errorResponse(error); }
}

export const GET = stream;
export const HEAD = stream;
