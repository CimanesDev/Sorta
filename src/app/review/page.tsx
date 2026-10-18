import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { Suspense } from "react";
import { ReviewPanel } from "@/components/ReviewPanel";
import { Viewer } from "@/components/Viewer";
import { getPost, listPosts, reviewQueue } from "@/lib/db";

export const metadata: Metadata = { title: "Review" };

// /review            → the next post waiting for review
// /review?after=ID   → the next waiting post after ID (used by Approve and Skip)
// /review?post=ID    → that exact post, reviewed or not (opened from the Posts page)
type Props = { searchParams: Promise<{ after?: string; post?: string }> };

export default function ReviewPage(props: Props) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Review {...props} />
    </Suspense>
  );
}

async function Review({ searchParams }: Props) {
  await io();
  const sp = await searchParams;
  const queue = reviewQueue();
  const all = listPosts();
  const reviewed = all.filter((p) => p.reviewedAt).length;
  const sorted = all.filter((p) => p.finalPrimary).length;

  const chosen = Number(sp.post) ? getPost(Number(sp.post)) : null;
  const after = Number(sp.after) || 0;

  if (!chosen && !queue.length)
    return (
      <div className="caught-up">
        <div className="check-big" aria-hidden="true">
          ✓
        </div>
        <h1>All caught up</h1>
        <p className="muted">
          {sorted
            ? `Every category the AI chose has been checked (${reviewed} of ${sorted} posts reviewed). Open any post from the Posts page to change it.`
            : "Nothing to review yet. Upload posts and they'll appear here once the AI has sorted them."}
        </p>
        <Link href="/" className="btn primary">
          Go to posts
        </Link>
      </div>
    );

  // Next post after the one just handled (wrapping around), so Skip moves forward too.
  const post = chosen ?? getPost(queue.find((x) => x > after) ?? queue[0])!;
  const total = sorted || 1;

  return (
    <div className="detail">
      <nav className="detail-bar">
        <Link href="/" className="back">
          ← Posts
        </Link>
        <h1 className="detail-title">
          {post.postCode} <span>{post.pageCode}</span>
        </h1>
        <span className={`review-state${post.reviewedAt ? " yes" : ""}`}>
          {post.reviewedAt
            ? post.source === "human"
              ? "✓ Reviewed · changed by you"
              : "✓ Reviewed · AI approved"
            : post.finalPrimary
              ? "Not reviewed yet"
              : "Not sorted yet"}
        </span>
        <div className="review-progress" aria-label={`${reviewed} of ${sorted} reviewed`}>
          <span className="bar">
            <span style={{ width: `${(100 * reviewed) / total}%` }} />
          </span>
          <span>{queue.length ? `${queue.length} left to review` : "All reviewed"}</span>
        </div>
      </nav>
      <div className="detail-grid">
        <Viewer images={post.images} title={`${post.pageCode} · ${post.postCode}`} />
        <ReviewPanel key={`${post.id}-${post.reviewedAt}-${post.finalPrimary}`} post={post} nextAfter={post.id} />
      </div>
    </div>
  );
}
