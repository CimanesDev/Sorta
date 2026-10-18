// Content categories from the thesis (specific objective 1). Do not rename ids once posts are coded.
// hint = one-line summary on the review screen; definition = the original codebook wording;
// examples = typical posts. Definition and examples show on hover and are given to the AI.
export const CATEGORIES = [
  {
    id: "education",
    label: "Oral Health Education",
    short: "Education",
    hint: "tips, facts, how-tos",
    definition:
      "Primary purpose is to inform about oral health, prevention, conditions or treatments (tips, myths, how-tos).",
    examples:
      "Brushing and flossing tips, myths vs facts, explaining a condition or procedure (e.g. what a root canal is), aftercare advice.",
  },
  {
    id: "advertisement",
    label: "Advertisement of Clinical Services",
    short: "Advertisement",
    hint: "promos, prices, services",
    definition:
      "Promotes the clinic's services, treatments, prices, packages or promos to attract patients.",
    examples:
      "Promos and discounts, price lists, braces or whitening packages, “book now / message us”, showcasing a service, results or new equipment.",
  },
  {
    id: "announcement",
    label: "Public Announcement",
    short: "Announcement",
    hint: "hours, closures, events, staff",
    definition:
      "Clinic operations: schedule or holiday hours, location changes, new staff, events, outreach activities.",
    examples:
      "Clinic hours, holiday closures, moving or a new branch, welcoming a new dentist, events, outreach and dental missions.",
  },
  {
    id: "testimonial",
    label: "Patient Testimonial",
    short: "Testimonial",
    hint: "reviews, thank-yous, feedback",
    definition:
      "Reviews, thank-you messages, or patient stories/photos presented as feedback about the clinic.",
    examples:
      "Patient reviews or star ratings, screenshots of patient comments or chats, “Salamat po Doc!”, “Hindi masakit, recommended!”, a patient's story, or the clinic thanking a pictured patient.",
  },
  {
    id: "misc",
    label: "Miscellaneous",
    short: "Miscellaneous",
    hint: "greetings, memes, anything else",
    definition:
      "Anything that fits none of the above (greetings, memes, general holidays, unrelated content).",
    examples: "Holiday or weekday greetings, memes, trivia unrelated to dentistry, anything that fits no other category.",
  },
] as const;

// How to choose when a post seems to fit more than one category.
export const DECISION_RULES = [
  "Check for a testimonial first: if the post's main content is a patient's review, rating, comment, thank-you or story about the clinic (in English or Tagalog, e.g. “Salamat po Doc”, “ang galing”, “hindi masakit”), it is Testimonial, even if it also says “book now” or names a promo (tick Advertisement under Also contains).",
  "Otherwise, pick the post's main purpose. Anything else it clearly includes goes under “Also contains”.",
  "A promo, price or “book now” makes it Advertisement, even if it also gives a tip (tick Education under Also contains).",
  "Hours, closures, moves, new staff and events are Announcement, even when written as a greeting.",
  "Before-and-after or patient photos are Testimonial when they come with the patient's words or thanks; when they only showcase the clinic's work, they are Advertisement.",
  "Use Miscellaneous only when no other category fits. It is never an “Also contains”.",
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as CategoryId[];

export function isCategory(v: unknown): v is CategoryId {
  return typeof v === "string" && (CATEGORY_IDS as string[]).includes(v);
}

export function category(id: string | null | undefined) {
  return CATEGORIES.find((c) => c.id === id);
}
