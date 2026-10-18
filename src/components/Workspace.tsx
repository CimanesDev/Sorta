"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CATEGORIES, category, type CategoryId } from "@/lib/categories";
import type { Post } from "@/lib/db";
import { CategoryPicker } from "./CategoryPicker";

type Uploading = { key: string; url: string; label: string };
const NEW = "__new";

// Card or list view, remembered in this browser.
type View = "cards" | "list";
const VIEW_KEY = "sorta-view";
const VIEW_EVENT = "sorta-view-change";
function subscribeView(cb: () => void) {
  window.addEventListener(VIEW_EVENT, cb);
  return () => window.removeEventListener(VIEW_EVENT, cb);
}
function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}
function saveView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
  window.dispatchEvent(new Event(VIEW_EVENT));
}

export function Workspace(props: { posts: Post[]; pages: string[]; newPage: string; aiReady: boolean }) {
  const { posts, aiReady } = props;
  const router = useRouter();
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const view = useSyncExternalStore(subscribeView, savedView, () => "cards" as View);
  const [page, setPage] = useState(props.pages.at(-1) ?? NEW);
  const [separate, setSeparate] = useState(true);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<number | null>(null);
  const tried = useRef(new Set<number>());
  const busy = useRef(false);
  const [round, setRound] = useState(0);

  // ---- automatic sorting: every post without a category goes through the local AI, one at a time
  const pendingKey = posts.filter((p) => p.aiStatus === "pending").map((p) => p.id).join(",");
  useEffect(() => {
    const queue = pendingKey ? pendingKey.split(",").map(Number).filter((id) => !tried.current.has(id)) : [];
    if (!aiReady || busy.current || !queue.length) return;
    busy.current = true;
    (async () => {
      for (const id of queue) {
        tried.current.add(id);
        setSorting(id);
        await fetch(`/api/posts/${id}/classify`, { method: "POST" }).catch(() => null);
        router.refresh();
      }
      setSorting(null);
      busy.current = false;
      setRound((r) => r + 1); // pick up anything uploaded while this run was going
    })();
  }, [pendingKey, aiReady, router, round]);

  async function retry(id: number) {
    setSorting(id);
    await fetch(`/api/posts/${id}/classify`, { method: "POST" }).catch(() => null);
    setSorting(null);
    router.refresh();
  }

  // ---- upload: each screenshot becomes its own post, or all of them form one post
  async function upload(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setError(null);
    const groups = separate ? imgs.map((f) => [f]) : [imgs];
    const items = groups.map((g) => ({
      key: crypto.randomUUID(),
      url: URL.createObjectURL(g[0]),
      label: g.length > 1 ? `${g.length} screenshots` : g[0].name,
    }));
    setUploading((u) => [...items, ...u]);
    let pageCode = page === NEW ? props.newPage : page;
    for (const [i, g] of groups.entries()) {
      const form = new FormData();
      form.set("page", pageCode);
      g.forEach((f) => form.append("images", f));
      const res = await fetch("/api/posts", { method: "POST", body: form }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) setError(body?.error ?? "Upload failed. Is the website still running?");
      else pageCode = body.pageCode;
      setUploading((u) => u.filter((x) => x.key !== items[i].key));
      URL.revokeObjectURL(items[i].url);
      router.refresh();
    }
    setPage(pageCode);
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        upload(Array.from(e.clipboardData.files));
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<CategoryId, number>;
  for (const p of posts) if (p.finalPrimary) counts[p.finalPrimary]++;
  const sorted = posts.filter((p) => p.finalPrimary).length;
  const shown = [...posts].reverse().filter((p) => filter === "all" || p.finalPrimary === filter);
  const waiting = posts.length - sorted;

  return (
    <>
      <label
        className={`drop${over ? " over" : ""}${posts.length ? "" : " big"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(Array.from(e.dataTransfer.files));
        }}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <span className="drop-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
        </span>
        <span className="drop-text">
          <b>Drop Facebook post screenshots</b>
          <span>
            or <u>browse</u> · or paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>. They&apos;re sorted automatically.
          </span>
        </span>
      </label>

      <div className="options">
        <label className="opt">
          Clinic
          <select value={page} onChange={(e) => setPage(e.target.value)}>
            {props.pages.map((p) => (
              <option key={p}>{p}</option>
            ))}
            <option value={NEW}>New clinic · {props.newPage}</option>
          </select>
        </label>
        <div className="seg" role="radiogroup" aria-label="How to group screenshots">
          <button type="button" role="radio" aria-checked={separate} onClick={() => setSeparate(true)}>
            Each screenshot is a post
          </button>
          <button type="button" role="radio" aria-checked={!separate} onClick={() => setSeparate(false)}>
            All screenshots are one post
          </button>
        </div>
        {!aiReady && (
          <span className="opt-note">Local AI is off, so new posts wait unsorted. Start Ollama and they&apos;ll sort themselves.</span>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {posts.length + uploading.length > 0 && (
        <section className="list-wrap">
          <div className="list-head">
            <div className="filters" role="tablist" aria-label="Filter by category">
              <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>
                All <span>{posts.length}</span>
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  data-cat={c.id}
                  aria-selected={filter === c.id}
                  onClick={() => setFilter(filter === c.id ? "all" : c.id)}
                  disabled={!counts[c.id]}
                >
                  <i className="dot" />
                  {c.short} <span>{counts[c.id]}</span>
                </button>
              ))}
            </div>
            <div className="head-right">
            <span className="progress-note" aria-live="polite">
              {sorting !== null || uploading.length ? (
                <>
                  <span className="spinner tiny" /> Sorting… {waiting + uploading.length} left
                </>
              ) : waiting ? (
                `${waiting} not sorted`
              ) : (
                <>✓ All {posts.length} sorted</>
              )}
            </span>
            <div className="view-toggle" role="radiogroup" aria-label="View">
              <button type="button" role="radio" aria-checked={view === "cards"} onClick={() => saveView("cards")} title="Card view" aria-label="Card view">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
              </button>
              <button type="button" role="radio" aria-checked={view === "list"} onClick={() => saveView("list")} title="List view" aria-label="List view">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
              </button>
            </div>
            </div>
          </div>

          <ul className={view === "cards" ? "cards" : "list"}>
            {uploading.map((u) => (
              <li key={u.key} className="row ghost">
                <div className="thumb-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="thumb" src={u.url} alt="" />
                </div>
                <div className="ident">
                  <b>Uploading…</b>
                  <span>{u.label}</span>
                </div>
                <div className="status">
                  <span className="spinner tiny" />
                </div>
              </li>
            ))}
            {shown.map((p) => {
              const others = p.finalCategories.filter((c) => c !== p.finalPrimary);
              const isSorting = sorting === p.id || (aiReady && p.aiStatus === "pending");
              return (
                <li key={p.id} className="row">
                  <Link href={`/review?post=${p.id}`} className="row-link" aria-label={`Review ${p.pageCode} ${p.postCode}`} />
                  <div className="thumb-wrap">
                    {p.images[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={`/api/images/${p.images[0]}`} alt="" loading="lazy" />
                    )}
                    {p.finalPrimary && (
                      <span
                        className={`rev-badge${p.reviewedAt ? " yes" : ""}`}
                        title={p.reviewedAt ? "Reviewed by a person" : "Not reviewed yet"}
                      >
                        {p.reviewedAt ? "✓ Reviewed" : "To review"}
                      </span>
                    )}
                  </div>
                  <div className="ident">
                    <b>{p.postCode}</b>
                    <span>
                      {p.pageCode}
                      {p.images.length > 1 && ` · ${p.images.length} images`}
                    </span>
                  </div>
                  <div className="cat-cell">
                    {isSorting ? (
                      <span className="pill sorting">
                        <span className="spinner tiny" /> Sorting…
                      </span>
                    ) : (
                      <CategoryPicker id={p.id} value={p.finalPrimary} also={others} />
                    )}
                    {others.length > 0 && !isSorting && (
                      <span className="also">+ {others.map((c) => category(c)?.short).join(", ")}</span>
                    )}
                  </div>
                  <div className="status">
                    {p.aiStatus === "error" && p.source !== "human" ? (
                      <button type="button" className="link-btn" onClick={() => retry(p.id)} title={p.aiError ?? undefined}>
                        Couldn&apos;t sort · Retry
                      </button>
                    ) : p.source === "human" ? (
                      <span className="who human">Changed by you</span>
                    ) : p.source === "ai" && p.reviewedAt ? (
                      <span className="who">AI · approved</span>
                    ) : p.source === "ai" ? (
                      <span className="who">AI · {p.aiConfidence} confidence</span>
                    ) : null}
                    <span className="go" aria-hidden="true">
                      →
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className="muted center">No posts in this category.</p>}
        </section>
      )}
    </>
  );
}
