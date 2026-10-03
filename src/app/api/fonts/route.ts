import { createHash } from "node:crypto";
import { publicFonts, errorResponse } from "@/lib/server/fonts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const fonts = await publicFonts();
    const body = JSON.stringify(fonts);
    const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = { "Cache-Control": "no-cache", ETag: etag, "Content-Type": "application/json; charset=utf-8" };
    return request.headers.get("if-none-match") === etag ? new Response(null, { status: 304, headers }) : new Response(body, { headers });
  } catch (error) { return errorResponse(error); }
}
