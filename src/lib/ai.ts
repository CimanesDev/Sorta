import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CATEGORIES, CATEGORY_IDS, isCategory, type CategoryId } from "./categories";
import { IMAGES_DIR } from "./db";
import { hideIdentities } from "./privacy";
import { redact } from "./redact";

// Local AI via Ollama (https://ollama.com). Runs on this computer; screenshots never leave it.
export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const AI_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5vl:7b";
const MAX_IMAGES = 3; // later screenshots of the same post rarely change the category

export type AiStatus = { state: "ready" } | { state: "no-model" } | { state: "offline" };

export async function aiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!res.ok) return { state: "offline" };
    const { models = [] } = (await res.json()) as { models?: { name: string }[] };
    const want = AI_MODEL.includes(":") ? AI_MODEL : `${AI_MODEL}:latest`;
    return models.some((m) => m.name === want) ? { state: "ready" } : { state: "no-model" };
  } catch {
    return { state: "offline" };
  }
}

export class AiError extends Error {}

const SYSTEM = [
  "You categorize Facebook posts published by private dental clinics in Metro Manila, for a descriptive",
  "content-analysis research study. You receive screenshot(s) of ONE post. Text may be English, Filipino/Tagalog or Taglish.",
  "",
  "Categories:",
  ...CATEGORIES.map((c, i) => `${i + 1}. ${c.id} - ${c.label}: ${c.definition} Examples: ${c.examples}`),
  "",
  "STEP 1, check for a testimonial FIRST. The post is testimonial if its main content is a patient's feedback about the clinic:",
  "- a review, rating or star score; a screenshot of a patient's comment, chat/Messenger message or Google/Facebook review;",
  "- a thank-you or praise message written by a patient, or a patient's story or quote told as feedback;",
  "- the clinic sharing or thanking a specific patient for their visit/trust while showing that patient, their words or their result",
  "  (e.g. \"Thank you for trusting us, Ms. [name]!\", \"Happy patient!\", \"Patient feedback\");",
  "- before-and-after or patient photos that come WITH the patient's words or thanks.",
  "  Tagalog/Taglish signs of feedback: \"Salamat po Doc\", \"Thank you po\", \"maraming salamat\", \"ang galing ni Doc\", \"ang bait\",",
  "  \"sobrang galing/ganda/bait\", \"hindi masakit\", \"walang sakit\", \"di ko naramdaman\", \"recommended ko\", \"highly recommended\",",
  "  \"sulit\", \"solid\", \"babalik ako\", \"10/10\", \"5 stars\", \"review\", \"feedback\", \"happy patient\", \"satisfied patient\".",
  "  A testimonial stays testimonial even if the caption also says \"book now\", names a service, or mentions a promo:",
  "  put advertisement in also_contains instead. Don't call it advertisement just because it ends with a call to action.",
  "",
  "STEP 2, only if it is not a testimonial, decide by the post's main purpose:",
  "- primary_category is the single MAIN purpose of the post.",
  "- also_contains lists other categories only when the post ALSO has a clear, substantial part of that type (for example a",
  "  promo post that also gives a real oral-health tip). Most posts have none: leave it empty. Never repeat the primary.",
  "  Never put misc in also_contains; misc only means the post fits none of the categories.",
  "- Colours, layout and graphic style don't decide the category; only the post's message does.",
  "- A promo or price is advertisement even if it includes a tip. Clinic hours, closures, moves, events = announcement.",
  "- Before-and-after or patient photos that only showcase the clinic's work, with no patient feedback or thanks = advertisement.",
  "- Greetings, holidays, memes and unrelated content = misc.",
  "- Judge only what is visible. If unsure, say so with confidence 'low'.",
  "- text: transcribe the caption and text in the images briefly; replace names of people, clinics, phone numbers and addresses with [REDACTED].",
  "- reason: ONE short sentence (under 30 words) explaining the main category, without naming people or clinics.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    primary_category: { type: "string", enum: CATEGORY_IDS },
    also_contains: { type: "array", items: { type: "string", enum: CATEGORY_IDS }, maxItems: 3 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string", maxLength: 220 },
    text: { type: "string", maxLength: 700 },
  },
  required: ["primary_category", "also_contains", "confidence", "reason", "text"],
};

async function encode(filename: string) {
  const buf = await sharp(path.join(IMAGES_DIR, filename))
    .resize({ width: 1024, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return buf.toString("base64");
}

// The model's answer was unusable (it looped, rambled, or broke the format); worth one more try.
class BadAnswer extends AiError {}

// The first try is deterministic. If the model gets stuck repeating itself, the retry adds a little
// randomness and a repetition penalty, which usually breaks the loop.
const ATTEMPTS: Record<string, number>[] = [
  { temperature: 0 },
  { temperature: 0.4, repeat_penalty: 1.2, seed: 7 },
];

async function ask(images: string[], tuning: Record<string, number>) {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        stream: false,
        format: SCHEMA,
        keep_alive: "20m",
        // num_predict caps the answer length; with the maxLength limits above a full answer fits easily.
        options: { num_ctx: 12288, num_predict: 700, ...tuning },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Categorize this post (${images.length} screenshot(s)).`, images },
        ],
      }),
      signal: AbortSignal.timeout(300_000), // first run loads the model (~40 s); a post takes 15-60 s, longer on a busy or small GPU
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new AiError("The local AI took too long. Try again.");
    throw new AiError("Can't reach the local AI. Is Ollama running?");
  }
  if (res.status === 404) throw new AiError(`Model ${AI_MODEL} is not installed. Run: ollama pull ${AI_MODEL}`);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (/repeat|repetit/i.test(detail)) throw new BadAnswer("The local AI got stuck repeating itself. Try again.");
    throw new AiError(`Local AI error (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { message?: { content?: string }; done_reason?: string };
  let out: Record<string, unknown>;
  try {
    out = JSON.parse(body.message?.content ?? "");
  } catch {
    throw new BadAnswer("The local AI returned an unreadable answer. Try again.");
  }
  if (!isCategory(out.primary_category)) throw new BadAnswer("The local AI returned an unknown category. Try again.");
  return out;
}

export async function classify(filenames: string[]) {
  if (!filenames.length) throw new AiError("This post has no screenshots.");
  const images = await Promise.all(filenames.slice(0, MAX_IMAGES).map(encode));

  let out: Record<string, unknown> | null = null;
  for (const [i, tuning] of ATTEMPTS.entries()) {
    try {
      out = await ask(images, tuning);
      break;
    } catch (e) {
      if (!(e instanceof BadAnswer) || i === ATTEMPTS.length - 1) throw e;
    }
  }
  if (!out || !isCategory(out.primary_category)) throw new AiError("The local AI returned an unknown category. Try again.");
  const primary: CategoryId = out.primary_category;
  // "Miscellaneous" means "none of the above", so it can never be a secondary category.
  const also = Array.isArray(out.also_contains) ? out.also_contains.filter(isCategory).filter((c) => c !== "misc") : [];
  return {
    primary,
    categories: [primary, ...new Set(also.filter((c) => c !== primary))],
    confidence: ["low", "medium", "high"].includes(String(out.confidence)) ? String(out.confidence) : "low",
    // The model often ignores the prompt's [REDACTED] rule, so names, numbers and links are removed here.
    reason: redact(String(out.reason ?? "").slice(0, 1000)),
    text: redact(String(out.text ?? "").slice(0, 4000)),
    model: AI_MODEL,
  };
}

export async function saveScreenshot(dir: string, index: number, data: ArrayBuffer) {
  // Faces and the post's header row are blurred before anything is written, so the original screenshot
  // never reaches the disk. Re-encoding also drops EXIF/GPS metadata (EXIF orientation is applied first).
  // A random part in the name gives every upload its own address, so a browser can never show an
  // old image (e.g. a deleted post's) in place of a new one.
  const { png } = await hideIdentities(Buffer.from(data));
  const rel = `${dir}/${String(index).padStart(2, "0")}-${crypto.randomBytes(4).toString("hex")}.png`;
  await fs.mkdir(path.join(IMAGES_DIR, dir), { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, rel), png);
  return rel;
}
