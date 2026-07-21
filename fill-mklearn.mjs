/**
 * Bulk content filler for MK Learn (post7s) — substantial, AdSense-quality
 * articles with Imagen covers and validated source links.
 *
 * Unlike the daily run-one generator (700-1000w), this targets 1300-1800 words
 * with 7-9 H2 sections, lists and a key-takeaways block — for filling the site.
 *
 * Run: COUNT=20 node --env-file=.env fill-mklearn.mjs
 * Env: GEMINI_API_KEY, STRAPI_API_URL, STRAPI_TOKEN ("Bearer " included).
 */

import { generateCover } from "./coverImage.js";
import { buildValidatedSources, sourcesToBlocks, weaveInlineLinks } from "./sourceLinks.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.MKLEARN_GEMINI_MODEL || "gemini-2.5-flash";
const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || "";
const COUNT = Math.max(1, parseInt(process.env.COUNT || "10", 10));

const CATEGORIES = ["what-is", "online-courses", "student-loans", "reviews"];
const SITE_CONTEXT =
  'MKLern Pro ("Study smarter. Borrow wiser. Move forward.") — an independent publication of plain-language explainers, online-course breakdowns and education-financing guides. Categories: what-is (finance/credit/education terms decoded), online-courses (certificates, bootcamps, degrees), student-loans (borrowing and repaying for education), reviews (frameworks for judging lenders, platforms and financial products).';

const log = (...a) => console.log("[fill-mklearn]", ...a);

async function strapi(path, init = {}) {
  const res = await fetch(`${STRAPI_URL}/api/${path}`, {
    ...init,
    headers: { Authorization: STRAPI_TOKEN, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body?.error || "")}`);
  return body;
}

async function gemini(prompt, schema, temperature = 0.8) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: schema
          ? { responseMimeType: "application/json", responseSchema: schema, temperature }
          : { temperature },
      }),
      signal: AbortSignal.timeout(180000),
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

const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
        },
        required: ["title", "category"],
      },
    },
  },
  required: ["topics"],
};

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    imagePrompt: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["h2", "h3", "p", "ul"] }, text: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["type"] } },
  },
  required: ["title", "description", "tags", "imagePrompt", "sections"],
};

async function fetchAllTitles() {
  const titles = [];
  let page = 1, pageCount = 1;
  do {
    const res = await strapi(`post7s?fields[0]=title&pagination[page]=${page}&pagination[pageSize]=100`);
    titles.push(...(res.data || []).map((a) => a.title).filter(Boolean));
    pageCount = res.meta?.pagination?.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount);
  return titles;
}

// --- main -------------------------------------------------------------------

if (!GEMINI_KEY || !STRAPI_URL || !STRAPI_TOKEN) throw new Error("missing GEMINI_API_KEY / STRAPI_API_URL / STRAPI_TOKEN");

const existing = await fetchAllTitles();
log(`existing articles: ${existing.length}; generating ${COUNT} new`);

const { topics } = await gemini(
  `${SITE_CONTEXT}\n\nBrainstorm exactly ${COUNT} fresh, specific, useful article topics spread across ALL four categories (roughly even split). ` +
  `Each topic must answer a real question readers search for; be concrete, not generic. ` +
  `STRICTLY avoid duplicating or closely resembling any of these existing titles:\n${existing.join("\n")}\n\nReturn JSON per schema.`,
  TOPICS_SCHEMA,
  0.9,
);
log(`topics brainstormed: ${topics.length}`);

const catIds = {};
for (const slug of CATEGORIES) {
  const r = await strapi(`category7s?filters[slug][$eq]=${slug}&fields[0]=slug`);
  catIds[slug] = r.data?.[0]?.id;
}
const authRes = await strapi(`author7s?fields[0]=name&pagination[pageSize]=50`);
const authors = authRes.data || [];

let ok = 0, fail = 0;
for (const [i, t] of topics.slice(0, COUNT).entries()) {
  const label = `${i + 1}/${Math.min(topics.length, COUNT)}`;
  try {
    const a = await gemini(
      `You write for ${SITE_CONTEXT}\n` +
      `Write a SUBSTANTIAL, thorough, accurate plain-language article on: "${t.title}" (category: ${t.category}). ` +
      `Audience: learners and self-improvers making real money-and-education decisions — beginner to intermediate.\n` +
      `Requirements: 1300-1800 words TOTAL; open with 2 intro paragraphs (type "p") BEFORE any heading; then 7-9 "h2" sections, each with 2-3 "p" paragraphs (occasionally an "h3" subsection); include 2-3 "ul" lists of 4-6 items spread through the article; END with an "h2" titled "Key Takeaways" containing one "ul" of 4-6 crisp takeaways. ` +
      `Practical, evergreen, example-driven; explain terms on first use; do NOT invent specific statistics, prices, interest rates or brand claims; frame everything as general education, never personalized financial advice. ` +
      `Also: a "description" (~150-char meta description) and 5-7 lowercase "tags". ` +
      `Also "imagePrompt": ONE specific, concrete cover scene whose MAIN SUBJECT literally embodies the exact concept of THIS article (not a generic person-at-a-laptop). Name the medium first ("modern editorial photograph", "clean cinematic 3D render", or "minimal conceptual illustration"), then main subject, setting, composition, lighting/mood. Premium magazine-cover quality; AVOID whiteboards, sticky notes, documents, books, screens with text/UI; NO readable text, words, numbers, logos, watermarks. ~35-50 words. ` +
      `Return JSON per schema.`,
      ARTICLE_SCHEMA,
    );
    if (!a?.title || !Array.isArray(a.sections) || a.sections.length < 8) throw new Error("malformed/short article");

    let slug = slugify(a.title);
    const exists = await strapi(`post7s?filters[slug][$eq]=${encodeURIComponent(slug)}&fields[0]=slug`).catch(() => ({ data: [] }));
    if ((exists.data || []).length) slug = `${slug.slice(0, 70)}-${Math.floor(Math.random() * 9000) + 1000}`;

    const scene = (a.imagePrompt && a.imagePrompt.trim().length > 20)
      ? a.imagePrompt.trim()
      : `A clean, modern editorial cover scene representing "${a.title}" for an education-finance magazine`;
    const { id: imageId, src: imgSrc } = await generateCover({ scene, prefix: `mklearn-${slug}` });

    let sources = [];
    try {
      sources = await buildValidatedSources({ title: a.title, summary: a.description || t.title, siteContext: SITE_CONTEXT });
    } catch (e) {
      log(`${label} sources failed (publishing without): ${e.message}`);
    }
    const contentBlocks = sectionsToBlocks(a.sections);
    const inline = weaveInlineLinks(contentBlocks, sources, 2);
    const content = [...contentBlocks, ...sourcesToBlocks(sources)];

    const words = a.sections.map((s) => [s.text || "", ...(s.items || [])].join(" ")).join(" ").split(/\s+/).length;
    const payload = {
      data: {
        title: a.title,
        slug,
        description: a.description || "",
        content,
        ...(imageId ? { featuredImage: imageId } : {}),
        ...(catIds[t.category] ? { category: catIds[t.category] } : {}),
        ...(authors.length ? { author: authors[Math.floor(Math.random() * authors.length)].id } : {}),
        tags: a.tags || [],
        views: Math.floor(Math.random() * 150) + 30,
        isPopular: false,
      },
    };
    const created = await strapi(`post7s?status=published`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    ok += 1;
    log(`${label} OK "${a.title}" (${t.category}) ~${words}w img=${imgSrc}#${imageId || "none"} src=${sources.length}+${inline}inl doc=${created?.data?.documentId}`);
  } catch (e) {
    fail += 1;
    log(`${label} FAIL "${t.title}": ${e.message}`);
  }
}

log(`done: ${ok} published, ${fail} failed`);
