/**
 * MK Learn (mklearn.pro) — education, online-courses & student-finance content generator.
 *
 * Self-contained on purpose: it does NOT touch functionsPostBase.js (the shared
 * engine for nice-advice / cholesterin / hairstyles), because post7 uses the
 * MKLern-style schema (flat `content` blocks + `slug`). Mirrors functionsUxdictionary.js.
 *
 * Generates ONE article via Gemini, generates an AI cover (Imagen / Gemini image
 * via coverImage.js — no web scraping), and publishes to post7s in the shared Strapi.
 *
 * Env: GEMINI_API_KEY, STRAPI_API_URL, STRAPI_TOKEN (already includes "Bearer ").
 */

import { generateCover } from "./coverImage.js";
import { buildValidatedSources, sourcesToBlocks, weaveInlineLinks } from "./sourceLinks.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.MKLEARN_GEMINI_MODEL || "gemini-2.5-flash";
const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer " prefix

// 4 categories (mirror lib/config.ts on the MK Learn frontend), each with
// topic angles Gemini brainstorms a fresh, specific title from.
const CATEGORIES = [
  { slug: "what-is", themes: ["a core personal-finance concept explained (APR, compound interest, credit score, cosigner...)", "a credit and borrowing term decoded", "an education-system term explained (accreditation, credit hours, transcripts...)", "a financial-aid concept explained (FAFSA-style aid, grants vs loans, work-study)", "an online-learning term explained (MOOC, micro-credential, bootcamp, cohort-based course)", "an investing or saving basic explained for students", "a banking product explained plainly"] },
  { slug: "online-courses", themes: ["how to choose an online course or certificate", "getting real value out of a bootcamp", "university online degrees vs alternatives", "free vs paid learning resources", "building a study routine for self-paced learning", "turning an online course into a career move", "evaluating course quality before you pay", "certificates employers actually care about"] },
  { slug: "student-loans", themes: ["understanding student-loan types and terms", "repayment strategies step by step", "refinancing and consolidation basics", "borrowing less: planning education costs", "what happens if you struggle to repay", "loan forgiveness and assistance concepts", "co-signing an education loan: what it means", "budgeting through school with debt"] },
  { slug: "reviews", themes: ["a framework for comparing online lenders", "what to look for in a learning platform before subscribing", "how to read loan fine print like a pro", "comparing bootcamp financing options (ISAs, loans, upfront)", "warning signs of a low-quality course or program", "how to evaluate a 'buy now pay later' offer", "choosing a student bank account or card: criteria that matter"] },
];

const log = (...a) => console.log("[mklearn]", ...a);

async function strapi(path, init = {}) {
  const res = await fetch(`${STRAPI_URL}/api/${path}`, {
    ...init,
    headers: { Authorization: STRAPI_TOKEN, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body?.error || "")}`);
  return body;
}

async function gemini(prompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: schema
          ? { responseMimeType: "application/json", responseSchema: schema, temperature: 0.8 }
          : { temperature: 0.9 },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(body?.error || "")?.slice(0, 200)}`);
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("empty gemini response");
  return schema ? JSON.parse(text) : text.trim();
}

function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function sectionsToBlocks(sections) {
  const p = (text) => ({ type: "paragraph", children: [{ type: "text", text }] });
  const blocks = [];
  for (const s of sections || []) {
    if (s.type === "h2" && s.text) blocks.push({ type: "heading", level: 2, children: [{ type: "text", text: s.text }] });
    else if (s.type === "h3" && s.text) blocks.push({ type: "heading", level: 3, children: [{ type: "text", text: s.text }] });
    else if (s.type === "p" && s.text) blocks.push(p(s.text));
    else if (s.type === "ul" && Array.isArray(s.items)) blocks.push({ type: "list", format: "unordered", children: s.items.map((i) => ({ type: "list-item", children: [{ type: "text", text: i }] })) });
  }
  return blocks;
}

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    imagePrompt: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["h2", "p", "ul"] }, text: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["type"] } },
  },
  required: ["title", "description", "tags", "imagePrompt", "sections"],
};

/** Generate + publish one MK Learn article. Returns documentId or null. */
export async function generateAndPostMklearn() {
  if (!GEMINI_KEY || !STRAPI_URL || !STRAPI_TOKEN) throw new Error("missing GEMINI_API_KEY / STRAPI_API_URL / STRAPI_TOKEN");

  // 1) pick a category + recent-titles bias
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const recent = await strapi(`post7s?fields[0]=title&sort[0]=createdAt:desc&pagination[pageSize]=40`).catch(() => ({ data: [] }));
  const recentTitles = (recent.data || []).map((a) => a.title).filter(Boolean);

  // 2) brainstorm a fresh, specific topic
  const theme = cat.themes[Math.floor(Math.random() * cat.themes.length)];
  const topic = await gemini(
    `Brainstorm ONE specific, useful article topic for MKLern Pro, an independent publication about learning, online courses and education financing, in the "${cat.slug}" category, around: "${theme}". ` +
    `Return only a concise article-title-style topic (no quotes). Avoid anything close to these existing titles:\n${recentTitles.join("\n")}`,
  );

  // 3) full article
  const a = await gemini(
    `You write for MKLern Pro, an independent publication with the motto "Study smarter. Borrow wiser. Move forward." — plain-language explainers, course breakdowns and education-financing guides. ` +
    `Write a thorough, accurate, plain-language article on: "${topic}" (category: ${cat.slug}). Audience: learners and self-improvers making real money-and-education decisions — beginner to intermediate.\n` +
    `Requirements: 700-1000 words; 1-2 intro paragraphs (type "p") BEFORE any heading; then 4-6 "h2" sections each with 1-3 "p" paragraphs; include at least one "ul" list of 3-6 items; practical, evergreen, example-driven; do NOT invent specific statistics, prices, interest rates or brand claims; never present anything as personalized financial advice — frame it as general education. ` +
    `Also: a "description" (~150-char meta description) and 4-6 lowercase "tags". ` +
    `Also "imagePrompt": describe ONE specific, concrete cover scene whose MAIN SUBJECT literally embodies the exact concept of THIS article (not a generic person-at-a-laptop). Name the medium first (e.g. "modern editorial photograph", "clean cinematic 3D render", or "minimal conceptual illustration"), then the main subject, setting, composition and lighting/mood. Tasteful, premium, magazine-cover quality; AVOID whiteboards, sticky notes, documents, books, or screens showing text/UI; NO readable text, words, letters, numbers, logos or watermarks. One vivid sentence, ~35-50 words. ` +
    `Return JSON per schema.`,
    ARTICLE_SCHEMA,
  );
  if (!a?.title || !Array.isArray(a.sections) || a.sections.length < 3) throw new Error("malformed article from gemini");

  // 4) category + author ids (post7 uses plain `category` / `author` relations)
  const catRes = await strapi(`category7s?filters[slug][$eq]=${encodeURIComponent(cat.slug)}&fields[0]=slug`);
  const categoryId = catRes.data?.[0]?.id;
  const authRes = await strapi(`author7s?fields[0]=name&pagination[pageSize]=50`);
  const authors = authRes.data || [];
  const authorId = authors.length ? authors[Math.floor(Math.random() * authors.length)].id : undefined;

  // 5) unique slug
  let slug = slugify(a.title);
  for (let i = 0; i < 5; i++) {
    const exists = await strapi(`post7s?filters[slug][$eq]=${encodeURIComponent(slug)}&fields[0]=slug`).catch(() => ({ data: [] }));
    if (!(exists.data || []).length) break;
    slug = `${slugify(a.title).slice(0, 70)}-${Math.floor(Math.random() * 9000) + 1000}`;
  }

  // 6) cover image — AI-generated (Imagen -> Gemini image), never scraped
  const scene = (a.imagePrompt && a.imagePrompt.trim().length > 20)
    ? a.imagePrompt.trim()
    : `A clean, modern editorial cover scene representing "${a.title}" (learning & education finance, category ${cat.slug}) for MKLern Pro`;
  const { id: imageId, src: imgSrc } = await generateCover({ scene, prefix: `mklearn-${slug}` });

  // 6.5) validated source links — 3-5 real references ("Sources" section + up to 2 inline)
  let sources = [];
  try {
    sources = await buildValidatedSources({
      title: a.title,
      summary: a.description || String(topic),
      siteContext: "MKLern Pro, an independent publication about learning, online courses, student loans and education financing",
    });
  } catch (e) {
    log(`sources failed (publishing without): ${e.message}`);
  }
  const contentBlocks = sectionsToBlocks(a.sections);
  const inlineCount = weaveInlineLinks(contentBlocks, sources, 2);
  const content = [...contentBlocks, ...sourcesToBlocks(sources)];
  log(`sources: ${sources.length} validated, ${inlineCount} inline`);

  // 7) publish
  const payload = {
    data: {
      title: a.title,
      slug,
      description: a.description || "",
      content,
      ...(imageId ? { featuredImage: imageId } : {}),
      ...(categoryId ? { category: categoryId } : {}),
      ...(authorId ? { author: authorId } : {}),
      tags: a.tags || [],
      views: Math.floor(Math.random() * 120) + 20,
      isPopular: false,
    },
  };
  const created = await strapi(`post7s?status=published`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const docId = created?.data?.documentId;
  log(`published "${a.title}" (/${slug}) doc=${docId} img=${imgSrc}#${imageId || "none"} cat=${categoryId}`);
  return { documentId: docId, title: a.title, slug };
}
