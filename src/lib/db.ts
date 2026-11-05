import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isCategory, type CategoryId } from "./categories";
import { redact } from "./redact";

// Everything (database + screenshots) lives in one local folder. Override with POSTCODER_DATA.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.POSTCODER_DATA ?? path.join(process.cwd(), "data"));
export const IMAGES_DIR = path.join(DATA_DIR, "images");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_code TEXT NOT NULL,
  post_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',   -- pending | done | error
  ai_primary TEXT,
  ai_categories TEXT,                          -- JSON array of category ids
  ai_confidence TEXT,
  ai_reason TEXT,
  ai_text TEXT,
  ai_model TEXT,
  ai_error TEXT,
  ai_at TEXT,
  final_primary TEXT,
  final_categories TEXT,                       -- JSON array: the category used in results
  confirmed_at TEXT,                           -- when a person last changed the category
  source TEXT,                                 -- 'ai' (set automatically) or 'human' (changed by a person)
  reviewed_at TEXT,                            -- when a person approved or changed the category
  UNIQUE (page_code, post_code)
);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  ord INTEGER NOT NULL
);
`;

const g = globalThis as unknown as { __postDb?: DatabaseSync };

export function db() {
  if (!g.__postDb) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const conn = new DatabaseSync(path.join(DATA_DIR, "posts.db"));
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    conn.exec(SCHEMA);
    const cols = (conn.prepare("PRAGMA table_info(posts)").all() as Row[]).map((c) => c.name);
    if (!cols.includes("source")) {
      conn.exec("ALTER TABLE posts ADD COLUMN source TEXT");
      conn.exec("UPDATE posts SET source = 'human' WHERE final_primary IS NOT NULL");
    }
    if (!cols.includes("reviewed_at")) {
      conn.exec("ALTER TABLE posts ADD COLUMN reviewed_at TEXT");
      conn.exec("UPDATE posts SET reviewed_at = confirmed_at WHERE source = 'human'");
    }
    renameLegacyImages(conn);
    redactSavedText(conn);
    g.__postDb = conn;
  }
  return g.__postDb;
}

type Row = Record<string, unknown>;

// Images saved by early versions were named 01.png, 02.png… so different posts could share an address
// and a browser could show a stale picture. Give each such file a unique name once, at startup.
function renameLegacyImages(conn: DatabaseSync) {
  const old = conn.prepare("SELECT id, filename FROM images").all() as Row[];
  for (const r of old) {
    const name = String(r.filename);
    if (/-[0-9a-f]{8}\.png$/.test(name)) continue;
    const next = name.replace(/\.png$/,`-${crypto.randomBytes(4).toString("hex")}.png`);
    try {
      fs.renameSync(path.join(IMAGES_DIR, name), path.join(IMAGES_DIR, next));
      conn.prepare("UPDATE images SET filename = ? WHERE id = ?").run(next, Number(r.id));
    } catch {
      // file missing: leave the row as it is
    }
  }
}

// AI text saved before redaction was added (or before its rules last changed) is cleaned once.
// Bump REDACT_VERSION when the rules in redact.ts change so older text is checked again.
const REDACT_VERSION = 1;
function redactSavedText(conn: DatabaseSync) {
  const { user_version } = conn.prepare("PRAGMA user_version").get() as { user_version: number };
  if (user_version >= REDACT_VERSION) return;
  const update = conn.prepare("UPDATE posts SET ai_text = ?, ai_reason = ? WHERE id = ?");
  for (const r of conn.prepare("SELECT id, ai_text, ai_reason FROM posts WHERE ai_text IS NOT NULL OR ai_reason IS NOT NULL").all() as Row[])
    update.run(r.ai_text == null ? null : redact(String(r.ai_text)), r.ai_reason == null ? null : redact(String(r.ai_reason)), Number(r.id));
  conn.exec(`PRAGMA user_version = ${REDACT_VERSION}`);
}

export type Post = {
  id: number;
  pageCode: string;
  postCode: string;
  createdAt: string;
  aiStatus: "pending" | "done" | "error";
  aiPrimary: CategoryId | null;
  aiCategories: CategoryId[];
  aiConfidence: string | null;
  aiReason: string | null;
  aiText: string | null;
  aiModel: string | null;
  aiError: string | null;
  finalPrimary: CategoryId | null;
  finalCategories: CategoryId[];
  editedAt: string | null;
  source: "ai" | "human" | null;
  reviewedAt: string | null;
  images: string[];
};

function cats(json: unknown): CategoryId[] {
  try {
    const v = JSON.parse(String(json ?? "[]"));
    return Array.isArray(v) ? v.filter(isCategory) : [];
  } catch {
    return [];
  }
}

function toPost(r: Row, images: string[]): Post {
  return {
    id: Number(r.id),
    pageCode: String(r.page_code),
    postCode: String(r.post_code),
    createdAt: String(r.created_at),
    aiStatus: r.ai_status as Post["aiStatus"],
    aiPrimary: isCategory(r.ai_primary) ? r.ai_primary : null,
    aiCategories: cats(r.ai_categories),
    aiConfidence: (r.ai_confidence as string) ?? null,
    aiReason: (r.ai_reason as string) ?? null,
    aiText: (r.ai_text as string) ?? null,
    aiModel: (r.ai_model as string) ?? null,
    aiError: (r.ai_error as string) ?? null,
    finalPrimary: isCategory(r.final_primary) ? r.final_primary : null,
    finalCategories: cats(r.final_categories),
    editedAt: (r.confirmed_at as string) ?? null,
    source: r.source === "ai" || r.source === "human" ? r.source : null,
    reviewedAt: (r.reviewed_at as string) ?? null,
    images,
  };
}

export function listPosts(): Post[] {
  const d = db();
  const imgs = new Map<number, string[]>();
  for (const r of d.prepare("SELECT post_id, filename FROM images ORDER BY post_id, ord").all() as Row[]) {
    const id = Number(r.post_id);
    imgs.set(id, [...(imgs.get(id) ?? []), String(r.filename)]);
  }
  return (d.prepare("SELECT * FROM posts ORDER BY page_code, post_code").all() as Row[]).map((r) =>
    toPost(r, imgs.get(Number(r.id)) ?? []),
  );
}

export function getPost(id: number): Post | null {
  const d = db();
  const r = d.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const images = (d.prepare("SELECT filename FROM images WHERE post_id = ? ORDER BY ord").all(id) as Row[]).map((x) =>
    String(x.filename),
  );
  return toPost(r, images);
}

export function pageCodes(): string[] {
  return (db().prepare("SELECT DISTINCT page_code FROM posts ORDER BY page_code").all() as Row[]).map((r) =>
    String(r.page_code),
  );
}

export function nextPostCode(pageCode: string): string {
  let n = 0;
  for (const r of db().prepare("SELECT post_code FROM posts WHERE page_code = ?").all(pageCode) as Row[]) {
    const m = /^POST(\d+)$/i.exec(String(r.post_code));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `POST${String(n + 1).padStart(3, "0")}`;
}

export function nextPageCode(): string {
  let n = 0;
  for (const code of pageCodes()) {
    const m = /^PAGE(\d+)$/i.exec(code);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `PAGE${String(n + 1).padStart(3, "0")}`;
}

export function postExists(pageCode: string, postCode: string) {
  return !!db().prepare("SELECT 1 FROM posts WHERE page_code = ? AND post_code = ?").get(pageCode, postCode);
}

export function insertPost(pageCode: string, postCode: string, filenames: string[]): number {
  const d = db();
  const res = d
    .prepare("INSERT INTO posts (page_code, post_code, created_at) VALUES (?, ?, ?)")
    .run(pageCode, postCode, new Date().toISOString());
  const id = Number(res.lastInsertRowid);
  const ins = d.prepare("INSERT INTO images (post_id, filename, ord) VALUES (?, ?, ?)");
  filenames.forEach((f, i) => ins.run(id, f, i + 1));
  return id;
}

export function saveAiResult(
  id: number,
  r: { primary: CategoryId; categories: CategoryId[]; confidence: string; reason: string; text: string; model: string },
) {
  db()
    .prepare(
      `UPDATE posts SET ai_status = 'done', ai_primary = ?, ai_categories = ?, ai_confidence = ?, ai_reason = ?,
       ai_text = ?, ai_model = ?, ai_error = NULL, ai_at = ? WHERE id = ?`,
    )
    .run(r.primary, JSON.stringify(r.categories), r.confidence, r.reason, r.text, r.model, new Date().toISOString(), id);
  // The AI's answer becomes the category unless a person has already changed it.
  db()
    .prepare(
      "UPDATE posts SET final_primary = ?, final_categories = ?, source = 'ai', reviewed_at = NULL WHERE id = ? AND COALESCE(source, '') != 'human'",
    )
    .run(r.primary, JSON.stringify(r.categories), id);
}

export function saveAiError(id: number, message: string) {
  db().prepare("UPDATE posts SET ai_status = 'error', ai_error = ?, ai_at = ? WHERE id = ?").run(
    message,
    new Date().toISOString(),
    id,
  );
}

export function saveHuman(id: number, primary: CategoryId, categories: CategoryId[]) {
  db()
    .prepare("UPDATE posts SET final_primary = ?, final_categories = ?, confirmed_at = ?, reviewed_at = ?, source = 'human' WHERE id = ?")
    .run(primary, JSON.stringify(categories), new Date().toISOString(), new Date().toISOString(), id);
}

// A person agrees with the AI's category.
export function approve(id: number) {
  db().prepare("UPDATE posts SET reviewed_at = ? WHERE id = ? AND final_primary IS NOT NULL").run(new Date().toISOString(), id);
}

// Posts the AI sorted that no person has checked yet, oldest first.
export function reviewQueue(): number[] {
  return (
    db().prepare("SELECT id FROM posts WHERE source = 'ai' AND reviewed_at IS NULL AND final_primary IS NOT NULL ORDER BY id").all() as Row[]
  ).map((r) => Number(r.id));
}

export function deletePost(id: number): string[] {
  const post = getPost(id);
  if (!post) return [];
  db().prepare("DELETE FROM posts WHERE id = ?").run(id);
  return post.images;
}
