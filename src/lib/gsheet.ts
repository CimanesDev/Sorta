import "server-only";
import { CATEGORIES, category } from "./categories";
import { listPosts, type Post } from "./db";
import { readSettings, updateSettings } from "./settings";

// Live copy of the results in the researcher's Google Sheet, via the Apps Script web app (lib/appsScript.ts).
// Only codes, categories and the AI's short reason are sent: no screenshots, no text read from the posts.

const COLOR: Record<string, string> = {
  education: "#2e8a5c", advertisement: "#cf4b3e", announcement: "#b9800f", testimonial: "#4b58d4", misc: "#7c8287",
};
const TINT: Record<string, string> = {
  education: "#e4f2ea", advertisement: "#f9e5e2", announcement: "#f7eedb", testimonial: "#e6e8fa", misc: "#ececed",
};

// Text from the AI must never be read as a spreadsheet formula.
const safe = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
};
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

const HEADER = ["Clinic", "Post", "Category", "Also contains", "Set by", "Reviewed", "AI confidence", "AI reason", "Uploaded"];
const WIDTHS = [80, 80, 260, 260, 70, 80, 100, 420, 130];

function postRow(p: Post) {
  return [
    p.pageCode, p.postCode, category(p.finalPrimary)?.label ?? "Not sorted yet",
    p.finalCategories.filter((c) => c !== p.finalPrimary).map((c) => category(c)?.label).join("; "),
    p.source === "human" ? "You" : p.source === "ai" ? "AI" : "", p.finalPrimary ? (p.reviewedAt ? "Yes" : "No") : "", p.aiConfidence ?? "", p.aiReason ?? "", when(p.createdAt),
  ].map(safe);
}

function postTab(name: string, posts: Post[], color?: string) {
  return {
    name, color, header: HEADER, widths: WIDTHS, catCol: 2,
    rows: posts.map(postRow),
    rowColors: posts.map((p) => (p.finalPrimary ? TINT[p.finalPrimary] : "")),
  };
}

export function buildPayload(token: string, posts = listPosts()) {
  const sorted = posts.filter((p) => p.finalPrimary);
  const pct = (n: number) => (sorted.length ? `${Math.round((1000 * n) / sorted.length) / 10}%` : "0%");
  const summaryRows: string[][] = CATEGORIES.map((c) => {
    const n = sorted.filter((p) => p.finalPrimary === c.id).length;
    const any = sorted.filter((p) => p.finalCategories.includes(c.id)).length;
    return [c.label, String(n), pct(n), String(any), pct(any)];
  });
  summaryRows.push(
    ["Total sorted", String(sorted.length), sorted.length ? "100%" : "0%", "", ""],
    ["", "", "", "", ""],
    ["Posts uploaded", String(posts.length), "", "", ""],
    ["Not sorted yet", String(posts.length - sorted.length), "", "", ""],
    ["Sorted by the AI", String(sorted.filter((p) => p.source === "ai").length), "", "", ""],
    ["Changed by a person", String(sorted.filter((p) => p.source === "human").length), "", "", ""],
    ["Reviewed by a person", String(sorted.filter((p) => p.reviewedAt).length), "", "", ""],
    ["Last updated", new Date().toLocaleString(), "", "", ""],
  );
  return {
    token,
    tabs: [
      {
        name: "Summary", header: ["Content category", "Posts (primary)", "% of posts", "Posts containing it", "% of posts"],
        widths: [260, 120, 90, 150, 90], catCol: 0, rows: summaryRows,
        rowColors: summaryRows.map((_, i) => (i < CATEGORIES.length ? TINT[CATEGORIES[i].id] : "")),
      },
      postTab("All posts", posts),
      ...CATEGORIES.map((c) => postTab(c.short, sorted.filter((p) => p.finalPrimary === c.id), COLOR[c.id])),
    ],
  };
}

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const TEST_RE = /^http:\/\/127\.0\.0\.1:\d+\/macros\/s\/[\w-]+\/exec$/; // automated tests only
export const isScriptUrl = (u: string) => URL_RE.test(u) || (process.env.POSTCODER_TEST_GOOGLE === "1" && TEST_RE.test(u));

export async function pushToGoogle(url: string, token: string): Promise<{ ok: true; sheetUrl?: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(buildPayload(token)),
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, error: "Couldn't reach Google. Check the internet connection." };
  }
  const text = await res.text();
  let body: { ok?: boolean; error?: string; url?: string };
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: /<html/i.test(text)
        ? "Google asked for a sign-in. In the deployment, set “Who has access” to “Anyone”, then deploy again."
        : `Unexpected reply from Google (${res.status}).`,
    };
  }
  if (!body.ok)
    return {
      ok: false,
      error: body.error === "Wrong token" ? "The script's token doesn't match. Copy the script from this page again." : body.error ?? "Google Sheet update failed.",
    };
  return { ok: true, sheetUrl: body.url };
}

// ---- automatic sync (debounced; one push at a time, re-run if changes came in meanwhile)
const g = globalThis as unknown as { __gsheet?: { timer?: NodeJS.Timeout; running?: boolean; again?: boolean; error?: string } };
const state = (g.__gsheet ??= {});

export function googleStatus() {
  const s = readSettings();
  return { connected: !!s.googleUrl, sheetUrl: s.googleSheetUrl ?? null, syncedAt: s.googleSyncedAt ?? null, error: state.error ?? null, syncing: !!state.running };
}

export async function syncGoogleNow() {
  const s = readSettings();
  if (!s.googleUrl) return { ok: false as const, error: "Not connected." };
  if (state.running) {
    state.again = true;
    return { ok: true as const };
  }
  state.running = true;
  try {
    const r = await pushToGoogle(s.googleUrl, s.googleToken);
    if (r.ok) {
      state.error = undefined;
      updateSettings({ googleSyncedAt: new Date().toISOString(), ...(r.sheetUrl ? { googleSheetUrl: r.sheetUrl } : {}) });
    } else state.error = r.error;
    return r;
  } finally {
    state.running = false;
    if (state.again) {
      state.again = false;
      scheduleGoogleSync();
    }
  }
}

export function scheduleGoogleSync() {
  if (!readSettings().googleUrl) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => void syncGoogleNow(), 2500);
}
