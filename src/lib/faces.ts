import "server-only";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

// Face detection with YuNet (OpenCV Zoo, MIT licence): a 230 KB model that runs on this computer.
// The model takes a fixed 640x640 BGR image, so tall screenshots are cut into overlapping tiles.
const MODEL = path.join(/*turbopackIgnore: true*/ process.cwd(), "models", "face_detection_yunet_2023mar.onnx");
const SIZE = 640;
const OVERLAP = 160; // a face cut by one tile's edge is whole in the next
const STRIDES = [8, 16, 32];
// Lower than OpenCV's default (0.9): a missed face is worse than blurring something that isn't one.
const MIN_SCORE = 0.6;
// Close-ups of teeth, braces and gums (common in dental posts) score up to ~0.78, real faces of
// normal size 0.85+. Tiny faces such as profile pictures score lower, so they keep the lower bar.
const MIN_SCORE_LARGE = 0.8;
const SMALL_FACE = 64; // px wide in the screenshot

// points: right eye, left eye, nose tip, right and left mouth corner (as seen from the person), [x, y] each.
export type Box = { x: number; y: number; w: number; h: number; score: number; points: number[] };

// Blurring can't run, so the upload is refused rather than saved with people or names visible.
export class PrivacyError extends Error {}

const g = globalThis as unknown as { __faceModel?: Promise<ort.InferenceSession> };

function model() {
  g.__faceModel ??= ort.InferenceSession.create(MODEL).catch((e) => {
    g.__faceModel = undefined; // let a later upload try again
    console.error(e);
    throw new PrivacyError("Face blurring isn't working, so the screenshots weren't saved. Is the models folder there?");
  });
  return g.__faceModel;
}

function blank(rgb: Buffer, w: number, h: number, tx: number, ty: number) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = ty; y < Math.min(h, ty + SIZE); y += 2)
    for (let x = tx; x < Math.min(w, tx + SIZE); x += 2) {
      const i = (y * w + x) * 3;
      const v = rgb[i] + rgb[i + 1] + rgb[i + 2];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (hi - lo > 72) return false; // ~24 levels per channel: something is drawn here
    }
  return true;
}

// Runs the model on one tile (RGB pixels, top-left at tx,ty of a w-by-h image) and returns boxes
// in that image's coordinates.
async function detectTile(rgb: Buffer, w: number, h: number, tx: number, ty: number): Promise<Box[]> {
  if (blank(rgb, w, h, tx, ty)) return []; // screenshots are mostly plain background: skip those tiles quickly
  const input = new Float32Array(3 * SIZE * SIZE); // zero padding where the tile runs past the image
  const plane = SIZE * SIZE;
  for (let y = 0; y < SIZE && ty + y < h; y++) {
    for (let x = 0; x < SIZE && tx + x < w; x++) {
      const src = ((ty + y) * w + tx + x) * 3;
      const dst = y * SIZE + x;
      input[dst] = rgb[src + 2]; // B
      input[plane + dst] = rgb[src + 1]; // G
      input[2 * plane + dst] = rgb[src]; // R
    }
  }
  const out = await (await model()).run({ input: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });

  const boxes: Box[] = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`].data as Float32Array;
    const obj = out[`obj_${s}`].data as Float32Array;
    const bbox = out[`bbox_${s}`].data as Float32Array;
    const kps = out[`kps_${s}`].data as Float32Array;
    const cols = SIZE / s;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(Math.max(cls[i], 0), 1) * Math.min(Math.max(obj[i], 0), 1));
      if (score < MIN_SCORE) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = (col + bbox[i * 4]) * s;
      const cy = (row + bbox[i * 4 + 1]) * s;
      const bw = Math.exp(bbox[i * 4 + 2]) * s;
      const bh = Math.exp(bbox[i * 4 + 3]) * s;
      const points = Array.from({ length: 10 }, (_, k) => (k % 2 ? ty + (row + kps[i * 10 + k]) * s : tx + (col + kps[i * 10 + k]) * s));
      boxes.push({ x: tx + cx - bw / 2, y: ty + cy - bh / 2, w: bw, h: bh, score, points });
    }
  }
  return boxes;
}

function starts(length: number) {
  const out = [0];
  while (out[out.length - 1] + SIZE < length) out.push(Math.min(out[out.length - 1] + SIZE - OVERLAP, length - SIZE));
  return out;
}

// Finds faces at one scale of the image; boxes come back in the original image's coordinates.
async function detectAtScale(image: Buffer, width: number, height: number, scale: number): Promise<Box[]> {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgb = await sharp(image).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const boxes: Box[] = [];
  for (const ty of starts(h)) for (const tx of starts(w)) boxes.push(...(await detectTile(rgb, w, h, tx, ty)));
  return boxes.map((b) => ({ ...b, x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale, points: b.points.map((p) => p / scale) }));
}

// How much of the smaller box lies inside the other: a face found again as part of a bigger box counts too.
function overlap(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

// Close-ups of teeth and smiles, which dental posts are full of, can look like a face to the model.
// Such a detection needs a high score, and its points must sit like a face's: even tilted or turned,
// a face has two eyes a sensible distance apart, the nose below them and the mouth below the nose.
export function looksLikeFace(b: Box) {
  if (b.w >= SMALL_FACE && b.score < MIN_SCORE_LARGE) return false;
  const [rex, rey, lex, ley, nx, ny, rmx, rmy, lmx, lmy] = b.points;
  const inside = (x: number, y: number) =>
    x > b.x - b.w * 0.2 && x < b.x + b.w * 1.2 && y > b.y - b.h * 0.2 && y < b.y + b.h * 1.2;
  for (let k = 0; k < 10; k += 2) if (!inside(b.points[k], b.points[k + 1])) return false;
  const eyes = Math.hypot(lex - rex, ley - rey);
  if (eyes < b.w * 0.12) return false;
  // Distance below the eye line, measured across it so tilted heads still pass.
  const ex = (rex + lex) / 2;
  const ey = (rey + ley) / 2;
  const down = (x: number, y: number) => ((x - ex) * -(ley - rey) + (y - ey) * (lex - rex)) / eyes;
  const nose = down(nx, ny);
  const mouth = down((rmx + lmx) / 2, (rmy + lmy) / 2);
  const mouthWidth = Math.hypot(lmx - rmx, lmy - rmy);
  return nose > eyes * 0.15 && mouth > nose + eyes * 0.1 && mouth < eyes * 2.5 && mouthWidth > eyes * 0.3 && mouthWidth < eyes * 1.6;
}

// Every detection at every scale, before checking its shape or removing duplicates.
export async function findCandidates(image: Buffer, tiny = true): Promise<Box[]> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  if (!width || !height) return [];
  // Passes: the whole image in one tile (faces bigger than a tile), width fitted to one tile (most faces
  // in a phone screenshot), full size (small faces, e.g. in group photos), and double size for tiny
  // faces such as commenters' profile pictures. The last pass is skipped on very large images.
  const scales = new Set([Math.min(1, SIZE / Math.max(width, height)), Math.min(1, SIZE / width), 1]);
  if (tiny && width * height <= 2_600_000) scales.add(2);
  const all: Box[] = [];
  for (const s of scales) all.push(...(await detectAtScale(image, width, height, s)));
  return all;
}

// YuNet only finds faces that are roughly upright. In dental posts people are often lying back in the
// chair or leaning in sideways, so the image is also searched turned by these angles (clockwise degrees).
// Tiny faces (profile pictures) are upright, so the turned passes skip the double-size scale.
const ANGLES = [-45, 45, -90, 90];
// Turned copies give the model many more chances to mistake a smile close-up for a face, so a face
// found only there needs a clearly face-like score (teeth close-ups reach ~0.81, a turned face ~0.9).
const MIN_SCORE_TURNED = 0.86;

// Maps a box found in a copy of the image turned by `angle` back onto the original image. The turned
// box's corners are turned back and the box that holds them is kept, so a tilted face stays covered.
function turnBack(b: Box, angle: number, turnedW: number, turnedH: number, width: number, height: number): Box {
  const t = (angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const back = (x: number, y: number) => {
    const dx = x - turnedW / 2;
    const dy = y - turnedH / 2;
    return [dx * cos + dy * sin + width / 2, -dx * sin + dy * cos + height / 2];
  };
  const corners = [back(b.x, b.y), back(b.x + b.w, b.y), back(b.x, b.y + b.h), back(b.x + b.w, b.y + b.h)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  // The holding box of a turned square is up to 1.4 times bigger; trim part of that back.
  const shrink = 1 - 0.15 * Math.abs(Math.sin(2 * t));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = (Math.max(...xs) - Math.min(...xs)) * shrink;
  const h = (Math.max(...ys) - Math.min(...ys)) * shrink;
  const points: number[] = [];
  for (let k = 0; k < 10; k += 2) points.push(...back(b.points[k], b.points[k + 1]));
  return { x: cx - w / 2, y: cy - h / 2, w, h, score: b.score, points };
}

export async function detectFaces(image: Buffer): Promise<Box[]> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  // Faces are checked for a face's shape in the copy they were found in, where they are upright.
  const all = (await findCandidates(image)).filter(looksLikeFace);
  for (const angle of ANGLES) {
    const turned = await sharp(image).rotate(angle, { background: "#000" }).png().toBuffer();
    const { width: tw = 0, height: th = 0 } = await sharp(turned).metadata();
    for (const b of (await findCandidates(turned, false)).filter((c) => c.score >= MIN_SCORE_TURNED && looksLikeFace(c)))
      all.push(turnBack(b, angle, tw, th, width, height));
  }
  // Keep the best box where several passes or tiles found the same face.
  const kept: Box[] = [];
  for (const b of all.sort((a, c) => c.score - a.score)) if (kept.every((k) => overlap(k, b) < 0.5)) kept.push(b);
  return kept;
}
