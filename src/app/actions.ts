"use server";
import fs from "node:fs/promises";
import path from "node:path";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isCategory, type CategoryId } from "@/lib/categories";
import { IMAGES_DIR, approve, deletePost, getPost, saveHuman } from "@/lib/db";
import { scheduleSheetSave } from "@/lib/sheet";

// A person overrides the AI's category. Saved immediately.
export async function setCategories(id: number, primary: CategoryId, also: CategoryId[]) {
  if (!getPost(id) || !isCategory(primary)) return;
  const others = also.filter(isCategory).filter((c) => c !== primary);
  saveHuman(id, primary, [primary, ...new Set(others)]);
  scheduleSheetSave();
  refresh();
}

// Review page: approve the AI's category as is, or save the person's correction, then go to the next post.
export async function reviewPost(id: number, primary: CategoryId, also: CategoryId[]) {
  const post = getPost(id);
  if (!post || !isCategory(primary)) return;
  const others = [...new Set(also.filter(isCategory).filter((c) => c !== primary))];
  const same =
    primary === post.finalPrimary &&
    others.length === post.finalCategories.length - 1 &&
    others.every((c) => post.finalCategories.includes(c));
  if (same) approve(id);
  else saveHuman(id, primary, [primary, ...others]);
  scheduleSheetSave();
  refresh(); // update the "waiting for review" count in the navbar
  redirect(`/review?after=${id}`);
}

export async function removePost(id: number) {
  const images = deletePost(id);
  scheduleSheetSave();
  for (const d of new Set(images.map((f) => path.dirname(f)))) {
    const full = path.resolve(IMAGES_DIR, d);
    if (full.startsWith(IMAGES_DIR + path.sep)) await fs.rm(full, { recursive: true, force: true });
  }
  redirect("/");
}

// ---- Google Sheets connection
export type GoogleResult = { ok: boolean; error?: string };

export async function connectGoogle(url: string): Promise<GoogleResult> {
  const { isScriptUrl, pushToGoogle } = await import("@/lib/gsheet");
  const { readSettings, updateSettings } = await import("@/lib/settings");
  const clean = url.trim();
  if (!isScriptUrl(clean))
    return { ok: false, error: "That doesn't look like a web app link. It should start with https://script.google.com/macros/s/ and end with /exec." };
  const r = await pushToGoogle(clean, readSettings().googleToken);
  if (!r.ok) return r;
  updateSettings({ googleUrl: clean, googleSheetUrl: r.sheetUrl, googleSyncedAt: new Date().toISOString() });
  refresh();
  return { ok: true };
}

export async function syncGoogle(): Promise<GoogleResult> {
  const { syncGoogleNow } = await import("@/lib/gsheet");
  const r = await syncGoogleNow();
  refresh();
  return r;
}

export async function disconnectGoogle() {
  const { updateSettings } = await import("@/lib/settings");
  updateSettings({ googleUrl: undefined, googleSheetUrl: undefined, googleSyncedAt: undefined });
  refresh();
}
