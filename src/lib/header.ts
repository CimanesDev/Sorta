import "server-only";
import sharp from "sharp";

// Finds the header row of a Facebook post in a screenshot: the page's round profile picture at the
// top left, with the page name and "Ad · 🌐" or the date beside it. It looks the same in light and
// dark mode and on phone or desktop, so it is found by shape, without a model.

export type Area = { left: number; top: number; width: number; height: number };
// textLeft: where the page name starts, just right of the profile picture.
export type Header = Area & { textLeft: number };

const WORK = 480; // analyse a copy this wide; the header is large enough to find at this size
const INK = 60; // summed RGB difference from the background that counts as something drawn

// The colour most of the top strip of the screenshot has: the post's background (white, dark grey…).
// Only the top strip, so a large photo just below the header can't outweigh it.
function background(rgb: Buffer, w: number, h: number) {
  const counts = new Map<number, number>();
  for (let y = 0; y < Math.max(4, Math.floor(h * 0.15)); y += 2)
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 3;
      const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const key = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  return [((key >> 8) << 4) + 8, (((key >> 4) & 15) << 4) + 8, ((key & 15) << 4) + 8];
}

// 1 where something is drawn, grown by a pixel so a picture's edge doesn't break into pieces.
function inkMask(rgb: Buffer, w: number, h: number) {
  const [br, bg, bb] = background(rgb, w, h);
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++)
    ink[p] = Math.abs(rgb[p * 3] - br) + Math.abs(rgb[p * 3 + 1] - bg) + Math.abs(rgb[p * 3 + 2] - bb) > INK ? 1 : 0;
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) grown[yy * w + xx] = 1;
        }
    }
  return grown;
}

type Blob = { x0: number; y0: number; x1: number; y1: number; pixels: number[] };

// Connected shapes within the given region, as bounding boxes plus their pixels.
function blobs(mask: Uint8Array, w: number, rx: number, ry: number) {
  const seen = new Uint8Array(mask.length);
  const out: Blob[] = [];
  for (let y = 0; y < ry; y++)
    for (let x = 0; x < rx; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      const b: Blob = { x0: x, y0: y, x1: x, y1: y, pixels: [] };
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        const py = (p - px) / w;
        b.pixels.push(p);
        b.x0 = Math.min(b.x0, px);
        b.x1 = Math.max(b.x1, px);
        b.y0 = Math.min(b.y0, py);
        b.y1 = Math.max(b.y1, py);
        for (const q of [p - 1, p + 1, p - w, p + w]) {
          const qx = q % w;
          const qy = (q - qx) / w;
          if (qx < 0 || qy < 0 || qx >= rx || qy >= ry || Math.abs(qx - px) > 1) continue;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
      out.push(b);
    }
  return out;
}

// True if the shape is a filled circle (a profile picture), counting anything enclosed by it,
// e.g. a white logo inside a ring. A circle fills ~79% of its box; a square photo or text doesn't.
function isRound(b: Blob, w: number) {
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const inside = new Uint8Array(bw * bh);
  for (const p of b.pixels) inside[(Math.floor(p / w) - b.y0) * bw + ((p % w) - b.x0)] = 1;
  // Flood the box from its edges: whatever the flood can't reach is part of the shape.
  const outside = new Uint8Array(bw * bh);
  const stack: number[] = [];
  for (let x = 0; x < bw; x++) stack.push(x, (bh - 1) * bw + x);
  for (let y = 0; y < bh; y++) stack.push(y * bw, y * bw + bw - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (outside[p] || inside[p]) continue;
    outside[p] = 1;
    const x = p % bw;
    if (x > 0) stack.push(p - 1);
    if (x < bw - 1) stack.push(p + 1);
    if (p >= bw) stack.push(p - bw);
    if (p < bw * (bh - 1)) stack.push(p + bw);
  }
  let filled = 0;
  for (let p = 0; p < bw * bh; p++) if (!outside[p]) filled++;
  const fill = filled / (bw * bh);
  // The corners of a circle's box are empty; the middle row and column are full.
  const corner = (cx: number, cy: number) => (outside[cy * bw + cx] ? 0 : 1);
  const k = Math.max(1, Math.floor(bw * 0.08));
  const corners = corner(k, k) + corner(bw - 1 - k, k) + corner(k, bh - 1 - k) + corner(bw - 1 - k, bh - 1 - k);
  return fill > 0.68 && fill < 0.9 && corners === 0;
}

function inkIn(mask: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += mask[y * w + x];
  return n / Math.max(1, (x1 - x0) * (y1 - y0));
}

// The header row (profile picture, page name, location and date), in the image's own pixels, or null.
export async function findHeader(image: Buffer): Promise<Header | null> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  if (!width || !height) return null;
  const scale = Math.min(1, WORK / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const rgb = await sharp(image).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const mask = inkMask(rgb, w, h);

  // Profile pictures sit at the left edge, in the top half; on a phone ~10% of the width, on desktop ~5%.
  const candidates = blobs(mask, w, Math.round(w * 0.25), Math.round(h * 0.5))
    .filter((b) => {
      const bw = b.x1 - b.x0 + 1;
      const bh = b.y1 - b.y0 + 1;
      return bw >= w * 0.03 && bw <= w * 0.16 && bh / bw > 0.8 && bh / bw < 1.25;
    })
    .sort((a, b) => a.y0 - b.y0);

  for (const b of candidates) {
    const size = b.y1 - b.y0 + 1;
    // The page name and date are written just to the right of the picture.
    const textX = b.x1 + Math.round(size * 0.2);
    if (inkIn(mask, w, textX, b.y0, Math.min(w, textX + Math.round(w * 0.3)), b.y1 + 1) < 0.03) continue;
    if (!isRound(b, w)) continue;
    // Cover the picture and both lines of text across the whole width, with a little room around.
    const pad = size * 0.25;
    const top = Math.max(0, (b.y0 - pad) / scale);
    const bottom = Math.min(height, (b.y1 + 1 + pad) / scale);
    return { left: 0, top: Math.floor(top), width, height: Math.ceil(bottom - top), textLeft: Math.floor((b.x1 + 1) / scale) };
  }
  return null;
}
