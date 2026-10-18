import fs from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const file = path.resolve(IMAGES_DIR, ...parts);
  if (!file.startsWith(IMAGES_DIR + path.sep) || !file.endsWith(".png")) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
