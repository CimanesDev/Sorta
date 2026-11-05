// Finds identifying details in text: clinic names, people's names after a title, phone numbers,
// emails, links, handles and addresses. Used to clean the AI's transcription and reason before they
// are saved, and to find the words to blur in a screenshot's text. The AI is also asked to redact,
// but it often doesn't, so these rules always run. They catch the common patterns in clinic posts; a
// name with no title or other clue can still slip through, so the review screen remains the final check.

export const REDACTED = "[REDACTED]";

// Words that name a dental business ("Marcelino Dental Clinic", "ACE Dental Care"). "Orthodontic"
// alone is left out: it is usually an adjective ("ORTHODONTIC TREATMENT").
const BUSINESS = ["Dental", "Dentistry", "Dentist", "Dentists", "Orthodontics", "Orthodontist", "Oral Care"];
const SUFFIX = ["Clinic", "Clinics", "Care", "Center", "Centre", "Studio", "Group", "Hub", "Lounge", "Spa", "Office", "Services", "Associates", "Specialist", "Specialists", "Co.", "Inc.", "PH"];
// Words in almost every clinic name, and ordinary words that come before one ("Visit Our Dental
// Clinic", "BOOK YOUR DENTAL CHECKUP"): none of these identify a clinic.
const COMMON = new Set(
  `the and of by at in on to for with a an is are dr dra doc dental dentistry dentist dentists orthodontic orthodontics
  orthodontist oral care clinic clinics center centre studio group hub lounge spa office services associates specialist
  specialists co inc ph smile smiles family your our my new best book visit call message text free get try now today
  quality affordable gentle complete general kids pediatric cosmetic modern premier happy healthy beautiful bright
  perfect perfectly aligned trusted professional expert schedule consult consultation`.split(/\s+/),
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\d]/gu, "");
// Title Case or ALL CAPS, words separated by spaces.
const words = (list: string[]) =>
  `(?:${list.flatMap((w) => [w, w.toUpperCase()]).map((w) => w.split(" ").map(esc).join("[ \\t]+")).join("|")})`;

// A capitalized word. No full stop, so "Santa Rosa. Minsan" ends at "Rosa".
const CAP = "[A-Z][\\p{L}'’&-]*";
// Up to four capitalized words on the same line, then the business words.
const CLINIC = new RegExp(`\\b(?:${CAP}[ \\t]+){1,4}${words(BUSINESS)}(?:[ \\t]+${words(SUFFIX)})*`, "gu");

// How many leading characters of a clinic-name match are ordinary words; null when it has no name.
function clinicStart(match: string) {
  const parts = match.split(/([ \t]+)/);
  let offset = 0;
  for (let i = 0; i < parts.length; i += 2) {
    if (!COMMON.has(bare(parts[i]))) return offset;
    offset += parts[i].length + (parts[i + 1]?.length ?? 0);
  }
  return null;
}

const TITLE = "Dr|Dra|Doc|Doctor|Dentist|Ms|Mr|Mrs|Miss|Sir|Ma'?am|Mam|Maam|Ate|Kuya|Tita|Tito|Lola|Lolo|Engr|Atty|Prof";

// Each match is a span to hide; a lookbehind keeps the lead-in ("Dr. ", "is in ") visible.
const RULES: { re: RegExp; keep?: (m: string) => boolean }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g }, // email
  { re: /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|ph|net|org|me|ly)(?:\/\S*)?/gi }, // links
  { re: /(?<![\w@])@[\w.]{2,}/g }, // @handles
  // Phone numbers: 7+ digits with optional +63, spaces, dashes, dots or brackets. Prices (₱1,500) have commas.
  { re: /(?<![₱$\d,.])(?:\+?63[\s-]*)?\(?\d{2,4}\)?(?:[\s.-]*\d{3,4}){1,2}\b/g, keep: (m) => m.replace(/\D/g, "").length >= 7 },
  // Addresses
  { re: new RegExp(`\\b(?:Brgy\\.?|Barangay|B[lI1]k\\.?|Block|Lot|Unit|B[lI1]dg\\.?|Building|Purok|Phase)[ \\t]+[\\w.-]+(?:,?[ \\t]+${CAP}){0,4}`, "gu") },
  { re: new RegExp(`\\b\\d+[A-Za-z]?[ \\t]+(?:${CAP}[ \\t]+){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Highway|Hwy|Drive)\\b\\.?`, "gu") },
  { re: new RegExp(`\\b(?:${CAP}[ \\t]+){1,3}(?:City|Town|Village|Subdivision|Subd\\.|Mall)\\b`, "gu") },
  { re: new RegExp(`\\b(?:${CAP}[ \\t]+){1,3}(?:B[lI1]dg\\.?|Building|Tower|Plaza|Arcade|Complex|Commercial Center)(?![\\p{L}])`, "gu") }, // "Alpha Bldg" (read from images as "BIdg" too)
  { re: /\b\d{1,2}(?:\/?F|(?:st|nd|rd|th)[ \t]+(?:Floor|Flr\.?))(?![\p{L}\d])/gu }, // floors: "2F", "3/F", "2nd Floor"
  // Facebook's "… is in Santa Rosa." / "… is at Marcelino Dental Clinic." check-in line
  { re: new RegExp(`(?<=\\bis (?:in|at)[ \\t]+)${CAP}(?:[ \\t]+${CAP}){0,3}`, "gu") },
  // A title, then one to three capitalized words: "Dr. Ana Reyes", "Salamat Doc Mike".
  { re: new RegExp(`(?<=\\b(?:${TITLE})\\.?[ \\t]+)${CAP}(?:[ \\t]+${CAP}){0,2}`, "gu") },
];

// Hashtags that look like a clinic's name, e.g. #malagasangdentalclinic (but not #DentalClinic).
function clinicTag(tag: string) {
  const t = tag.slice(1).toLowerCase();
  if (!/dental|dentist|clinic|ortho/.test(t)) return false;
  return t.replace(/dentalclinic|dentalcare|dentistry|dentists?|dental|clinics?|orthodontics?|ortho|smiles?|care|cent(?:er|re)|studio|ph|the|by|dra?|doc/g, "").length >= 3;
}

// Small spelling differences, for text read from an image ("Marcelin0").
function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

const sameWord = (word: string, name: string) =>
  word === name || (name.length >= 5 && distance(word, name) <= 1) || (name.length >= 9 && distance(word, name) <= 2);

// The distinctive words of clinic names: "Marcelino" from "Marcelino Dental Clinic", "ngiti" from "Ngiti Studio".
function nameWords(names: string[]) {
  const out = new Set<string>();
  for (const n of names) for (const w of n.split(/[^\p{L}\d']+/u)) if (bare(w).length >= 3 && !COMMON.has(bare(w))) out.add(bare(w));
  return out;
}

export type Span = [start: number, end: number];

// Where the identifying details are in text. names: clinic names already known for this post (the
// page name read from the screenshot's header), matched loosely to allow for misread letters.
export function findSensitive(text: string, names: string[] = []): Span[] {
  if (!text) return [];
  const spans: Span[] = [];
  const found: string[] = [...names];

  for (const m of text.matchAll(CLINIC)) {
    const start = clinicStart(m[0]);
    if (start === null) continue;
    spans.push([m.index + start, m.index + m[0].length]);
    found.push(m[0].slice(start));
  }
  for (const { re, keep } of RULES)
    for (const m of text.matchAll(re)) if (!keep || keep(m[0])) spans.push([m.index, m.index + m[0].length]);

  // The clinic's own name wherever it appears alone ("ACE"), as a whole word so "face" is left alone,
  // and hashtags naming it: "#AceDentalPH" starts with its name; longer names may sit anywhere.
  const brands = [...nameWords(found)];
  // Every word of the known names, so "Marcelin0 Dental CIinic" is hidden whole, not just its first word.
  const known = new Set(names.flatMap((n) => n.split(/[^\p{L}\d']+/u).map(bare)).filter((w) => w.length >= 2));
  const tokens = [...text.matchAll(/#?[\p{L}\d_']+/gu)];
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i][0];
    const tag = word.startsWith("#") ? word.slice(1).toLowerCase() : null;
    const hit = tag
      ? clinicTag(word) || brands.some((b) => tag.startsWith(b) || (b.length >= 5 && tag.includes(b)))
      : brands.some((b) => sameWord(bare(word), b));
    if (!hit) continue;
    const start = tokens[i].index;
    let end = start + word.length;
    while (!tag && i + 1 < tokens.length && /^[ \t]+$/.test(text.slice(end, tokens[i + 1].index))) {
      const next = bare(tokens[i + 1][0]);
      if (![...known].some((k) => sameWord(next, k) || (k.length >= 4 && distance(next, k) <= 1))) break;
      i++;
      end = tokens[i].index + tokens[i][0].length;
    }
    spans.push([start, end]);
  }
  // A known name made only of common words ("Smile Dental Studio") is matched as a whole phrase.
  for (const n of names) {
    const parts = n.trim().split(/\s+/).filter(Boolean).map(esc);
    if (parts.length) for (const m of text.matchAll(new RegExp(parts.join("[ \\t]+"), "gi"))) spans.push([m.index, m.index + m[0].length]);
  }

  // Merge overlapping spans, and spans separated only by spaces or commas.
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && /^[ \t,]*$/.test(text.slice(last[1], s[0]))) last[1] = Math.max(last[1], s[1]);
    else if (last && s[0] < last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged;
}

export function redact(text: string, names: string[] = []): string {
  if (!text) return text;
  let out = "";
  let at = 0;
  for (const [s, e] of findSensitive(text, names)) {
    out += text.slice(at, s) + REDACTED;
    at = e;
  }
  out += text.slice(at);
  // Tidy the spaces left behind.
  return out.replace(/[ \t]+([.,!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
}
