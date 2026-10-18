import fs from "node:fs/promises";
import path from "node:path";
import { saveScreenshot } from "@/lib/ai";
import { IMAGES_DIR, insertPost, nextPageCode, nextPostCode, postExists } from "@/lib/db";
import { scheduleSheetSave } from "@/lib/sheet";

const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_FILES = 20;

// Upload one post: its screenshots in display order.
export async function POST(request: Request) {
  const form = await request.formData();
  const pageCode = String(form.get("page") ?? "").trim().toUpperCase() || nextPageCode();
  const postCode = String(form.get("post") ?? "").trim().toUpperCase() || nextPostCode(pageCode);
  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);

  if (!CODE_RE.test(pageCode) || !CODE_RE.test(postCode))
    return Response.json({ error: "Codes may only use letters, numbers, - and _ (e.g. PAGE001)." }, { status: 400 });
  if (!files.length) return Response.json({ error: "Add at least one screenshot." }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: `At most ${MAX_FILES} screenshots per post.` }, { status: 400 });
  if (postExists(pageCode, postCode))
    return Response.json({ error: `${pageCode} / ${postCode} already exists.` }, { status: 409 });

  const dir = `${pageCode}/${postCode}`;
  const saved: string[] = [];
  try {
    for (const [i, f] of files.entries()) saved.push(await saveScreenshot(dir, i + 1, await f.arrayBuffer()));
  } catch {
    await fs.rm(path.join(IMAGES_DIR, dir), { recursive: true, force: true });
    return Response.json({ error: "One of the files isn't a readable image." }, { status: 400 });
  }
  const id = insertPost(pageCode, postCode, saved);
  scheduleSheetSave();
  return Response.json({ id, pageCode, postCode });
}
