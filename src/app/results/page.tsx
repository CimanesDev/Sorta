import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { Suspense } from "react";
import { CATEGORIES } from "@/lib/categories";
import { listPosts } from "@/lib/db";
import { googleStatus } from "@/lib/gsheet";
import { SHEET_PATH, sheetStatus } from "@/lib/sheet";
import { pct } from "@/lib/stats";

export const metadata: Metadata = { title: "Results" };

export default function ResultsPage() {
  return (
    <>
      <header className="intro">
        <h1>Results</h1>
        <p>Share of posts in each content category. Updates as posts are sorted.</p>
      </header>
      <Suspense fallback={<p className="muted">Counting…</p>}>
        <Results />
      </Suspense>
    </>
  );
}

async function Results() {
  await io();
  const posts = listPosts();
  const sorted = posts.filter((p) => p.finalPrimary);
  const sheet = sheetStatus();
  const google = googleStatus();
  if (!sorted.length)
    return (
      <div className="blank">
        <p>Nothing sorted yet.</p>
        <Link href="/" className="btn primary">
          Add posts
        </Link>
      </div>
    );

  const rows = CATEGORIES.map((c) => ({
    ...c,
    n: sorted.filter((p) => p.finalPrimary === c.id).length,
    any: sorted.filter((p) => p.finalCategories.includes(c.id)).length,
  }));
  const max = Math.max(...rows.map((r) => r.n), 1);
  const byYou = sorted.filter((p) => p.source === "human").length;

  return (
    <>
      <section className="figures">
        <div>
          <span className="big-num">{sorted.length}</span>
          <span className="label">{sorted.length === 1 ? "post" : "posts"} sorted</span>
        </div>
        <div>
          <span className="big-num">{new Set(sorted.map((p) => p.pageCode)).size}</span>
          <span className="label">{new Set(sorted.map((p) => p.pageCode)).size === 1 ? "clinic" : "clinics"}</span>
        </div>
        <div>
          <span className="big-num">{pct(sorted.length - byYou, sorted.length)}%</span>
          <span className="label">kept as the AI sorted them</span>
        </div>
        <div>
          <span className="big-num">
            {sorted.filter((p) => p.reviewedAt).length}
            <small> / {sorted.length}</small>
          </span>
          <span className="label">checked by a person</span>
        </div>
      </section>

      <section className="chart" aria-label="Posts per category">
        {rows.map((r, i) => (
          <div key={r.id} className="chart-row" data-cat={r.id}>
            <div className="chart-label">
              <span className="dot" />
              {r.label}
            </div>
            <div className="chart-bar">
              <span style={{ width: `${(100 * r.n) / max}%`, animationDelay: `${i * 0.07}s` }} />
            </div>
            <div className="chart-val">
              <b>{pct(r.n, sorted.length)}%</b>
              <span>
                {r.n} post{r.n === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="also-table">
        <h2>Posts that contain each category</h2>
        <p className="muted">A post counts here for its main category and anything else it also contains.</p>
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-cat={r.id}>
                <td>
                  <span className="dot" /> {r.label}
                </td>
                <td className="num">{r.any}</td>
                <td className="num muted">{pct(r.any, sorted.length)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sheet-card">
        <div>
          <h2>Spreadsheets</h2>
          <p>
            Both update automatically after every change: a Summary, All posts, and one sheet per category.
            {google.connected ? " The Google Sheet is connected." : " Connect a Google Sheet to keep an online copy for the team."}
          </p>
          <p className="path mono">{SHEET_PATH}</p>
          {sheet.error && <p className="error">{sheet.error}</p>}
          {google.error && <p className="error">Google Sheet: {google.error}</p>}
        </div>
        <div className="panel-actions">
          {google.connected && google.sheetUrl ? (
            <a className="btn primary" href={google.sheetUrl} target="_blank" rel="noreferrer">
              Open Google Sheet ↗
            </a>
          ) : (
            <Link className="btn" href="/sheets">
              Connect Google Sheets
            </Link>
          )}
          <a className="btn" href="/api/sheet">
            Download Excel
          </a>
        </div>
      </section>
    </>
  );
}
