import "server-only";
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { PrivacyError } from "./faces";

// Reads the text in a screenshot with PaddleOCR (PP-OCRv4 text finder, PP-OCRv3 English reader;
// Apache 2.0, ONNX copies from RapidOCR). Runs on this computer. Each line comes back with the
// position of every character, so single words can be blurred.

const DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "models");
const TILE = 1280; // the text finder looks at tiles this tall
const OVERLAP = 192; // a line cut by one tile's edge is whole in the next
const MAX_WIDTH = 1280;
const LINE_HEIGHT = 48; // the reader's input height
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export type Line = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  xs: number[]; // centre of each character of text, in image pixels
};

const g = globalThis as unknown as { __ocr?: Promise<{ det: ort.InferenceSession; rec: ort.InferenceSession; chars: string[] }> };

function models() {
  g.__ocr ??= (async () => ({
    det: await ort.InferenceSession.create(path.join(DIR, "ppocr_v4_det.onnx")),
    rec: await ort.InferenceSession.create(path.join(DIR, "ppocr_v3_en_rec.onnx")),
    // Class 0 is "no character"; then the dictionary, then a space.
    chars: ["", ...fs.readFileSync(path.join(DIR, "ppocr_en_dict.txt"), "utf8").split(/\r?\n/).filter((c) => c.length === 1), " "],
  }))().catch((e) => {
    g.__ocr = undefined; // let a later upload try again
    console.error(e);
    throw new PrivacyError("Text blurring isn't working, so the screenshots weren't saved. Is the models folder there?");
  });
  return g.__ocr;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

// Finds text lines in one tile of a w-by-h RGB image; boxes in that image's pixels.
async function findLines(det: ort.InferenceSession, rgb: Buffer, w: number, h: number, ty: number): Promise<Box[]> {
  const th = Math.min(TILE, h - ty);
  const W = Math.ceil(w / 32) * 32;
  const H = Math.ceil(th / 32) * 32;
  const input = new Float32Array(3 * W * H);
  const plane = W * H;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < w; x++) {
      const s = ((ty + y) * w + x) * 3;
      const d = y * W + x;
      // Paddle models expect BGR.
      input[d] = (rgb[s + 2] / 255 - MEAN[0]) / STD[0];
      input[plane + d] = (rgb[s + 1] / 255 - MEAN[1]) / STD[1];
      input[2 * plane + d] = (rgb[s] / 255 - MEAN[2]) / STD[2];
    }
  const out = await det.run({ x: new ort.Tensor("float32", input, [1, 3, H, W]) });
  const prob = Object.values(out)[0].data as Float32Array;

  // Group neighbouring "text" pixels into lines, as PaddleOCR's own post-processing does.
  const seen = new Uint8Array(W * H);
  const boxes: Box[] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || prob[start] < 0.3) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, sum = 0, n = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % W;
      const py = (p - px) / W;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      sum += prob[p];
      n++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          const q = qy * W + qx;
          if (!seen[q] && prob[q] >= 0.3) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3 || sum / n < 0.6) continue;
    // The model marks a shrunken core of each line; grow it back (PaddleOCR's "unclip", ratio 1.5).
    const grow = (bw * bh * 1.5) / (2 * (bw + bh));
    boxes.push({
      x0: Math.max(0, x0 - grow),
      y0: Math.max(0, ty + y0 - grow),
      x1: Math.min(w, x1 + 1 + grow),
      y1: Math.min(h, ty + y1 + 1 + grow),
    });
  }
  return boxes;
}

// Reads one line: the text plus each character's centre, in the original image's pixels.
async function readLine(
  rec: ort.InferenceSession,
  chars: string[],
  image: Buffer,
  b: { left: number; top: number; width: number; height: number },
) {
  const lw = Math.max(LINE_HEIGHT / 2, Math.min(LINE_HEIGHT * 40, Math.round((LINE_HEIGHT * b.width) / b.height)));
  const rgb = await sharp(image).extract(b).resize(lw, LINE_HEIGHT, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const input = new Float32Array(3 * lw * LINE_HEIGHT);
  const plane = lw * LINE_HEIGHT;
  for (let p = 0; p < plane; p++) {
    input[p] = (rgb[p * 3 + 2] / 255 - 0.5) / 0.5;
    input[plane + p] = (rgb[p * 3 + 1] / 255 - 0.5) / 0.5;
    input[2 * plane + p] = (rgb[p * 3] / 255 - 0.5) / 0.5;
  }
  const out = Object.values(await rec.run({ x: new ort.Tensor("float32", input, [1, 3, LINE_HEIGHT, lw]) }))[0];
  const [, steps, classes] = out.dims as number[];
  const data = out.data as Float32Array;
  let text = "";
  const xs: number[] = [];
  let prev = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    for (let c = 1; c < classes; c++) if (data[t * classes + c] > data[t * classes + best]) best = c;
    // Greedy CTC: a character is emitted when the best class changes to something other than blank.
    if (best !== 0 && best !== prev && chars[best] !== undefined) {
      text += chars[best];
      xs.push(b.left + ((t + 0.5) / steps) * b.width);
    }
    prev = best;
  }
  return { text, xs };
}

export async function readText(image: Buffer): Promise<Line[]> {
  const { det, rec, chars } = await models();
  const { width = 0, height = 0 } = await sharp(image).metadata();
  if (!width || !height) return [];
  const scale = Math.min(1, MAX_WIDTH / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const rgb = await sharp(image).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();

  const tiles = [0];
  while (tiles[tiles.length - 1] + TILE < h) tiles.push(Math.min(tiles[tiles.length - 1] + TILE - OVERLAP, h - TILE));
  const found: Box[] = [];
  for (const ty of tiles) found.push(...(await findLines(det, rgb, w, h, ty)));
  // A line found again in the overlap of two tiles: keep the bigger box.
  const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const kept: Box[] = [];
  for (const b of found.sort((a, c) => area(c) - area(a))) {
    const dup = kept.some((k) => {
      const ix = Math.max(0, Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0));
      const iy = Math.max(0, Math.min(k.y1, b.y1) - Math.max(k.y0, b.y0));
      return ix * iy > 0.5 * area(b);
    });
    if (!dup) kept.push(b);
  }

  const lines: Line[] = [];
  for (const b of kept.sort((a, c) => a.y0 - c.y0 || a.x0 - c.x0)) {
    const box = {
      left: Math.floor(b.x0 / scale),
      top: Math.floor(b.y0 / scale),
      width: Math.max(1, Math.min(width, Math.ceil(b.x1 / scale)) - Math.floor(b.x0 / scale)),
      height: Math.max(1, Math.min(height, Math.ceil(b.y1 / scale)) - Math.floor(b.y0 / scale)),
    };
    if (box.width < 4 || box.height < 4) continue;
    const { text, xs } = await readLine(rec, chars, image, box);
    if (text.trim()) lines.push({ text, xs, ...box });
  }
  return lines;
}
