import { io } from "next/cache";
import { Suspense } from "react";
import { Workspace } from "@/components/Workspace";
import { aiStatus } from "@/lib/ai";
import { listPosts, nextPageCode, pageCodes } from "@/lib/db";

export default function PostsPage() {
  return (
    <>
      <header className="intro">
        <h1>Sort clinic posts</h1>
        <p>
          Drop in screenshots of Facebook posts. Each one is filed under a content category automatically and added to
          the spreadsheet. Click a category only if it&apos;s wrong.
        </p>
      </header>
      <Suspense fallback={<div className="drop big skeleton" />}>
        <Posts />
      </Suspense>
    </>
  );
}

async function Posts() {
  await io();
  const ai = await aiStatus();
  return <Workspace posts={listPosts()} pages={pageCodes()} newPage={nextPageCode()} aiReady={ai.state === "ready"} />;
}
