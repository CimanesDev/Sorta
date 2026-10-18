import { AiError, classify } from "@/lib/ai";
import { category } from "@/lib/categories";
import { getPost, saveAiError, saveAiResult } from "@/lib/db";
import { scheduleSheetSave } from "@/lib/sheet";

// Ask the local AI to categorize one post. Its answer becomes the category unless a person has set one.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const post = getPost(Number((await params).id));
  if (!post) return Response.json({ error: "Post not found." }, { status: 404 });
  try {
    const result = await classify(post.images);
    saveAiResult(post.id, result);
    scheduleSheetSave();
    return Response.json({ ok: true, primary: result.primary, label: category(result.primary)?.label, confidence: result.confidence });
  } catch (e) {
    const message = e instanceof AiError ? e.message : "Unexpected error while categorizing.";
    if (!(e instanceof AiError)) console.error(e);
    saveAiError(post.id, message);
    scheduleSheetSave();
    return Response.json({ error: message }, { status: 502 });
  }
}
