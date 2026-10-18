"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { removePost, reviewPost } from "@/app/actions";
import { CATEGORIES, DECISION_RULES, type CategoryId } from "@/lib/categories";
import type { Post } from "@/lib/db";
import { WhyAi } from "./WhyAi";

// One post in review: approve the category, or change it, then move on. Already-reviewed posts
// (opened from the Posts page) can be changed again the same way.
export function ReviewPanel({ post, nextAfter }: { post: Post; nextAfter: number }) {
  const startAlso = post.finalCategories.filter((c) => c !== post.finalPrimary);
  const [primary, setPrimary] = useState<CategoryId | null>(post.finalPrimary);
  const [also, setAlso] = useState<CategoryId[]>(startAlso);
  const [pending, start] = useTransition();

  const changed =
    primary !== post.finalPrimary || also.length !== startAlso.length || also.some((c) => !startAlso.includes(c));
  const label = changed ? "Save & next" : post.reviewedAt ? "Keep & next" : "Approve & next";

  function pick(c: CategoryId) {
    setPrimary(c);
    setAlso((a) => a.filter((x) => x !== c));
  }
  function toggle(c: CategoryId) {
    setAlso((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c]));
  }
  function submit() {
    if (!primary || pending) return;
    start(() => reviewPost(post.id, primary, also));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, select, textarea, button, a, summary")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= CATEGORIES.length) pick(CATEGORIES[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <aside className="side">
      <WhyAi post={post} />

      <section>
        <div className="side-head">
          <h2>Category</h2>
          <span className="save-state">
            {changed ? "Changed — not saved yet" : post.source === "human" ? "Set by you" : post.finalPrimary ? "As the AI chose" : "Choose one"}
          </span>
        </div>
        <div className="options-list" role="radiogroup" aria-label="Primary content category">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={primary === c.id}
              data-cat={c.id}
              className="option"
              title={`${c.definition}
Examples: ${c.examples}`}
              onClick={() => pick(c.id)}
            >
              <span className="radio" />
              <span className="option-text">
                <b>{c.label}</b>
                <span className="option-hint">{c.hint}</span>
              </span>
              <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
      </section>

      <details className="rules">
        <summary>How to decide</summary>
        <ul>
          {DECISION_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      <section>
        <div className="side-head">
          <h2>Also contains</h2>
        </div>
        <div className="toggles">
          {CATEGORIES.filter((c) => c.id !== primary && c.id !== "misc").map((c) => (
            <button
              key={c.id}
              type="button"
              className="toggle-chip"
              data-cat={c.id}
              aria-pressed={also.includes(c.id)}
              onClick={() => toggle(c.id)}
            >
              <span className="dot" />
              {c.short}
            </button>
          ))}
        </div>
      </section>

      <div className="review-actions">
        <button type="button" className={`btn primary big${changed ? " changed" : ""}`} onClick={submit} disabled={pending || !primary}>
          {pending ? <span className="spinner tiny" /> : null}
          {label}
          <kbd>Enter</kbd>
        </button>
        <Link href={`/review?after=${nextAfter}`} className="btn big ghost-link">
          Skip
        </Link>
      </div>
      <p className="review-hint">Press 1–5 to pick a category, Enter to confirm. Arrow keys flip screenshots.</p>

      <footer className="side-foot">
        {post.aiText ? (
          <details>
            <summary>Text the AI read</summary>
            <pre>{post.aiText}</pre>
          </details>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="link-btn danger"
          onClick={() => {
            if (confirm("Delete this post and its screenshots? This can't be undone.")) start(() => removePost(post.id));
          }}
        >
          Delete post
        </button>
      </footer>
    </aside>
  );
}
