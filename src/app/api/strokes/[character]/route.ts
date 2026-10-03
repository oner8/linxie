import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateText } from "@/lib/practice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dataDir = resolve(/* turbopackIgnore: true */ "node_modules/hanzi-writer-data");

export async function GET(_request: Request, { params }: { params: Promise<{ character: string }> }) {
  let character: string;
  try {
    character = validateText((await params).character);
    if ([...character].length !== 1) throw new Error("请输入一个汉字");
  } catch {
    return Response.json({ error: "请输入一个汉字" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const data = await readFile(join(/* turbopackIgnore: true */ dataDir, `${character}.json`), "utf8");
    return new Response(data, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return Response.json({ error: missing ? "暂无该字笔顺数据" : "笔顺数据暂时不可用，请重试" }, { status: missing ? 404 : 500, headers: { "Cache-Control": "no-store" } });
  }
}
