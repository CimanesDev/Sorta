import "server-only";
import sharp from "sharp";
import { detectFaces } from "./faces";
import { findHeader, type Header } from "./header";
import { readText, type Line } from "./ocr";
import { findSensitive } from "./redact";

type Area = { left: number; top: number; width: number; height: number; kind: "face" | "header" | "text" };

const middle = (l: Line) => l.top + l.height / 2;
const inHeader = (l: Line, h: Header | null) => !!h && middle(l) >= h.top && middle(l) <= h.top + h.height;

// The page's name, read from the header's first line before it is blurred. Facebook adds "is in",
// "is at", "with" and similar after the name. "is at" names a place's page, often the clinic itself
// ("Marcelino Dental Clinic is at Marcelino Dental Clinic."); "is in" is only the city, so not a name.
function pageNames(lines: Line[], header: Header | null) {
  if (!header) return [];
  const first = lines
    .filter((l) => inHeader(l, header) && l.left >= header.textLeft - 4 && /\p{L}{3}/u.test(l.text))
    .sort((a, b) => a.top - b.top)[0];
  if (!first) return [];
  const [name, ...rest] = first.text.split(/\s+(?:is|was|with|and|at|in|updated|shared|added|changed|feeling)\s+/i);
  const place = /\bis at\s+(.+)$/i.exec(first.text)?.[1];
  return [name, rest.length && place ? place : ""].map((n) => n.replace(/[.,!?:;·•\s]+$/, "").trim()).filter((n) => n.length >= 3);
}

// Hides who is in and behind a screenshot before it is saved: every face; the Facebook post's header
// row (the page's profile picture, name and location); and, anywhere in the image's text, the page's
// name, other clinic names, people's names after a title, phone numbers, emails, links and addresses.
// Returns the result as a PNG. Throws if a model can't run, so an upload never goes through with
// any of these left visible.
export async function hideIdentities(data: Buffer) {
  const image = await sharp(data).rotate().png().toBuffer(); // apply EXIF orientation before measuring
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const [faces, header, lines] = await Promise.all([detectFaces(image), findHeader(image), readText(image)]);
  const names = pageNames(lines, header);

  const areas: Area[] = faces.map((f) => {
    // Pad the box: YuNet's box is tight and hair, ears and chin still identify a person.
    const left = Math.max(0, Math.floor(f.x - f.w * 0.25));
    const top = Math.max(0, Math.floor(f.y - f.h * 0.3));
    return {
      left,
      top,
      width: Math.min(width, Math.ceil(f.x + f.w * 1.25)) - left,
      height: Math.min(height, Math.ceil(f.y + f.h * 1.2)) - top,
      kind: "face",
    };
  });
  if (header) areas.push({ ...header, kind: "header" });

  for (const l of lines) {
    if (inHeader(l, header)) continue; // blurred whole already
    const charWidth = l.width / Math.max(1, l.text.length);
    for (const [s, e] of findSensitive(l.text, names)) {
      // From just before the first character to just after the last, within the line's box.
      const x0 = Math.max(l.left, Math.floor(l.xs[s] - charWidth));
      const x1 = Math.min(l.left + l.width, Math.ceil(l.xs[e - 1] + charWidth));
      const top = Math.max(0, l.top - 2);
      areas.push({ left: x0, top, width: x1 - x0, height: Math.min(height, l.top + l.height + 2) - top, kind: "text" });
    }
  }

  const layers = await Promise.all(
    areas
      .filter((a) => a.width >= 2 && a.height >= 2)
      .map(async (a) => {
        // Strong enough that a face or a word can't be made out.
        const sigma = a.kind === "face" ? Math.max(a.width, a.height) / 5 : a.kind === "header" ? a.height / 5 : a.height * 0.6;
        let area = sharp(image)
          .extract({ left: a.left, top: a.top, width: a.width, height: a.height })
          .blur(Math.max(6, sigma))
          .ensureAlpha();
        if (a.kind === "face")
          area = area.composite([
            {
              input: Buffer.from(
                `<svg width="${a.width}" height="${a.height}"><ellipse cx="${a.width / 2}" cy="${a.height / 2}" rx="${a.width / 2}" ry="${a.height / 2}" fill="#fff"/></svg>`,
              ),
              blend: "dest-in",
            },
          ]);
        return { input: await area.png().toBuffer(), left: a.left, top: a.top };
      }),
  );
  const png = layers.length ? await sharp(image).composite(layers).png().toBuffer() : image;
  return { png, faces: faces.length, header: !!header, names: names.length, words: areas.filter((a) => a.kind === "text").length };
}
