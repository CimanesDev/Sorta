import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { CATEGORIES, category } from "./categories";
import { DATA_DIR, IMAGES_DIR, listPosts, type Post } from "./db";
import { scheduleGoogleSync } from "./gsheet";

// The spreadsheet is rewritten automatically after every change, so it always matches the website.
export const SHEET_PATH = path.join(DATA_DIR, "Post Categories.xlsx");

const COLOR: Record<string, string> = {
  education: "2A8A64", advertisement: "2C5BC8", announcement: "C27A22", testimonial: "A2478B", misc: "687880",
};
const TINT: Record<string, string> = {
  education: "E3F2EA", advertisement: "E4EBFA", announcement: "F8EDDC", testimonial: "F4E4EF", misc: "E9EDEF",
};
const INK = "12282A";

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Clinic", key: "clinic", width: 11 },
  { header: "Post", key: "post", width: 10 },
  { header: "Category", key: "category", width: 34 },
  { header: "Also contains", key: "also", width: 34 },
  { header: "Set by", key: "by", width: 9 },
  { header: "Reviewed", key: "reviewed", width: 10 },
  { header: "AI confidence", key: "conf", width: 13 },
  { header: "AI reason", key: "reason", width: 60 },
  { header: "Screenshots", key: "shots", width: 13 },
  { header: "Uploaded", key: "uploaded", width: 17 },
  { header: "Text read from the post", key: "text", width: 70 },
];

function row(p: Post) {
  const first = p.images[0] ? path.join(IMAGES_DIR, p.images[0]) : null;
  return {
    clinic: p.pageCode,
    post: p.postCode,
    category: category(p.finalPrimary)?.label ?? "Not sorted yet",
    also: p.finalCategories.filter((c) => c !== p.finalPrimary).map((c) => category(c)?.label).join("; "),
    by: p.source === "human" ? "You" : p.source === "ai" ? "AI" : "",
    reviewed: p.finalPrimary ? (p.reviewedAt ? "Yes" : "No") : "",
    conf: p.aiConfidence ?? "",
    reason: p.aiReason ?? p.aiError ?? "",
    shots: first ? { text: `Open (${p.images.length})`, hyperlink: `file:///${first.replace(/\\/g, "/")}` } : "",
    uploaded: new Date(p.createdAt),
    text: p.aiText ?? "",
  };
}

function styleHeader(ws: ExcelJS.Worksheet, color = INK) {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + color } };
  h.alignment = { vertical: "middle" };
  h.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function postSheet(wb: ExcelJS.Workbook, name: string, posts: Post[], color?: string) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: color ? { argb: "FF" + color } : undefined } });
  ws.columns = COLUMNS;
  for (const p of posts) {
    const r = ws.addRow(row(p));
    r.alignment = { vertical: "top", wrapText: true };
    r.getCell("uploaded").numFmt = "yyyy-mm-dd hh:mm";
    r.getCell("shots").font = { color: { argb: "FF0C6A64" }, underline: true };
    if (p.finalPrimary) {
      const c = r.getCell("category");
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + TINT[p.finalPrimary] } };
      c.font = { bold: true, color: { argb: "FF" + COLOR[p.finalPrimary] } };
    }
  }
  styleHeader(ws, color);
  ws.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };
  return ws;
}

export function buildWorkbook(posts = listPosts()) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sorta";
  wb.created = new Date();
  const sorted = posts.filter((p) => p.finalPrimary);

  // Summary
  const s = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF" + INK } } });
  s.columns = [
    { header: "Content category", key: "cat", width: 36 },
    { header: "Posts (primary)", key: "n", width: 16 },
    { header: "% of posts", key: "pct", width: 12 },
    { header: "Posts containing it", key: "any", width: 20 },
    { header: "% of posts", key: "anyPct", width: 12 },
  ];
  for (const c of CATEGORIES) {
    const n = sorted.filter((p) => p.finalPrimary === c.id).length;
    const any = sorted.filter((p) => p.finalCategories.includes(c.id)).length;
    const r = s.addRow({ cat: c.label, n, pct: sorted.length ? n / sorted.length : 0, any, anyPct: sorted.length ? any / sorted.length : 0 });
    r.getCell("cat").font = { bold: true, color: { argb: "FF" + COLOR[c.id] } };
  }
  const total = s.addRow({ cat: "Total sorted", n: sorted.length, pct: sorted.length ? 1 : 0 });
  total.font = { bold: true };
  total.border = { top: { style: "thin" } };
  for (let i = 2; i <= total.number; i++) {
    s.getRow(i).getCell("pct").numFmt = "0.0%";
    s.getRow(i).getCell("anyPct").numFmt = "0.0%";
  }
  s.addRow({});
  const notes: [string, string | number][] = [
    ["Posts uploaded", posts.length],
    ["Not sorted yet", posts.length - sorted.length],
    ["Sorted by the AI", sorted.filter((p) => p.source === "ai").length],
    ["Changed by a person", sorted.filter((p) => p.source === "human").length],
    ["Reviewed by a person", sorted.filter((p) => p.reviewedAt).length],
    ["Last updated", new Date().toLocaleString()],
  ];
  for (const [k, v] of notes) s.addRow({ cat: k, n: v }).getCell("cat").font = { color: { argb: "FF76857F" } };
  styleHeader(s);

  postSheet(wb, "All posts", posts);
  for (const c of CATEGORIES) postSheet(wb, c.short, sorted.filter((p) => p.finalPrimary === c.id), COLOR[c.id]);
  return wb;
}

// ---- automatic saving (debounced, so a burst of changes writes once)
const g = globalThis as unknown as { __sheet?: { timer?: NodeJS.Timeout; savedAt?: string; error?: string } };
const state = (g.__sheet ??= {});

export function sheetStatus() {
  return { path: SHEET_PATH, savedAt: state.savedAt ?? null, error: state.error ?? null };
}

export async function saveSheetNow() {
  const tmp = SHEET_PATH + ".tmp";
  try {
    await buildWorkbook().xlsx.writeFile(tmp);
    await fs.rename(tmp, SHEET_PATH);
    state.savedAt = new Date().toISOString();
    state.error = undefined;
  } catch (e) {
    await fs.rm(tmp, { force: true });
    const busy = e instanceof Error && /EBUSY|EPERM/.test(e.message);
    state.error = busy
      ? "The spreadsheet is open in Excel, so it couldn't be updated. Close it and it will update on the next change."
      : "The spreadsheet couldn't be saved.";
    if (!busy) console.error(e);
  }
}

// Called after every change: refresh the Excel file and, if connected, the Google Sheet.
export function scheduleSheetSave() {
  scheduleGoogleSync();
  clearTimeout(state.timer);
  state.timer = setTimeout(() => void saveSheetNow(), 800);
}
