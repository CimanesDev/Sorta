import { category } from "@/lib/categories";
import type { Post } from "@/lib/db";

// The AI's choice and its one-sentence reason, always visible.
export function WhyAi({ post }: { post: Post }) {
  const aiCat = category(post.aiPrimary);
  return (
    <section className="why" data-cat={post.aiPrimary ?? undefined}>
      <div className="why-head">
        <span className="why-label">
          {post.aiStatus === "error" ? "AI couldn't sort this post" : aiCat ? "AI chose" : "Not sorted yet"}
        </span>
        {aiCat && post.aiStatus === "done" && (
          <span className="why-cat">
            <span className="dot" />
            {aiCat.label}
          </span>
        )}
        {post.aiConfidence && post.aiStatus === "done" && <span className="why-conf">{post.aiConfidence} confidence</span>}
      </div>
      <p>
        {post.aiStatus === "error"
          ? post.aiError
          : post.aiReason ?? "The local AI will sort this post when it's running. You can also pick a category below."}
      </p>
    </section>
  );
}
