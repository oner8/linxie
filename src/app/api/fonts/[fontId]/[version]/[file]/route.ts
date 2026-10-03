import { createHash } from "node:crypto";
import { FontError, checkRate, errorResponse, fontSubset } from "@/lib/server/fonts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ fontId: string; version: string; file: string }> }) {
  const started = Date.now();
  try {
    checkRate(request);
    const { fontId, version, file } = await params;
    if (!file.endsWith(".woff2")) throw new FontError(400, "字体请求格式不正确");
    const result = await fontSubset(fontId, version, file.slice(0, -6));
    const etag = `"${createHash("sha256").update(result.bytes).digest("hex")}"`;
    const headers = { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "X-Font-Cache": result.hit ? "HIT" : "MISS" };
    console.info(JSON.stringify({ event: "font", font: fontId, hit: result.hit, ms: Date.now() - started }));
    return request.headers.get("if-none-match") === etag ? new Response(null, { status: 304, headers }) : new Response(new Uint8Array(result.bytes), { headers });
  } catch (error) { return errorResponse(error); }
}
