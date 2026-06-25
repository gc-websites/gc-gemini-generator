/**
 * PixelHost (pixelhost.io) — hosting-niche content generator.
 *
 * Self-contained on purpose: it does NOT touch functionsPostBase.js (the shared
 * engine for nice-advice / cholesterin / hairstyles), because post4 uses the
 * MKLern-style schema (flat `content` blocks + `slug`), NOT the post2/post3
 * shape (description blocks + paragraphs[]). It reuses only env + plain fetch.
 *
 * Generates ONE article via Gemini, finds a CC0 cover (Openverse), uploads it,
 * and publishes to the post4s collection in the shared Strapi.
 *
 * Env: GEMINI_API_KEY, STRAPI_API_URL, STRAPI_TOKEN (already includes "Bearer ").
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.PIXELHOST_GEMINI_MODEL || "gemini-2.5-flash";
const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer " prefix

// 5 hosting categories (mirror lib/config.ts on the frontend). Each lists a few
// topic angles Gemini brainstorms a fresh, specific title from.
const CATEGORIES = [
  { slug: "web-hosting", themes: ["choosing a web host", "shared vs VPS vs cloud vs dedicated", "uptime and reliability", "bandwidth and storage", "server locations and speed", "scaling a website", "free vs paid hosting"] },
  { slug: "wordpress", themes: ["speeding up WordPress", "WordPress security hardening", "managed vs unmanaged WordPress hosting", "essential plugins", "backups and updates", "fixing common WordPress errors", "caching"] },
  { slug: "domains", themes: ["registering a domain", "DNS records explained", "transferring a domain", "domain privacy / WHOIS", "subdomains vs subfolders", "connecting a domain to hosting", "email on your domain"] },
  { slug: "website-builders", themes: ["website builder vs WordPress", "getting a site online step by step", "choosing a CMS", "no-code site building", "ecommerce platforms basics", "migrating from a builder", "templates and themes"] },
  { slug: "reviews", themes: ["what cheap hosting really includes", "how to read a hosting review", "spotting hidden renewal pricing", "evaluating support quality", "money-back guarantees", "comparing hosting plans", "green/eco hosting"] },
];

const log = (...a) => console.log("[pixelhost]", ...a);

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

async function findCoverImage(query, imagePrefix) {
  try {
    const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=cc0&page_size=20`, { headers: { "User-Agent": "PixelHostGen/1.0" } });
    if (!res.ok) return null;
    const body = await res.json();
    const cands = [...(body.results || []).filter((r) => (r.width ?? 0) >= 1000), ...(body.results || []).filter((r) => (r.width ?? 0) < 1000)];
    for (const c of cands.slice(0, 8)) {
      try {
        const ir = await fetch(c.url, { headers: { "User-Agent": "Mozilla/5.0 (PixelHostGen/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
        if (!ir.ok) continue;
        const ct = (ir.headers.get("content-type") || "image/jpeg").split(";")[0];
        if (!ct.startsWith("image/")) continue;
        const buf = Buffer.from(await ir.arrayBuffer());
        if (buf.length < 30000) continue;
        const form = new FormData();
        form.append("files", new Blob([buf], { type: ct }), `${imagePrefix}-cover.${ct.includes("png") ? "png" : "jpg"}`);
        const up = await fetch(`${STRAPI_URL}/api/upload`, { method: "POST", headers: { Authorization: STRAPI_TOKEN }, body: form });
        const ub = await up.json().catch(() => null);
        if (up.ok && ub?.[0]?.id) return ub[0].id;
      } catch { /* next candidate */ }
    }
  } catch { /* no image */ }
  return null;
}

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    sections: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["h2", "p", "ul"] }, text: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["type"] } },
  },
  required: ["title", "description", "tags", "sections"],
};

/** Generate + publish one PixelHost article. Returns documentId or null. */
export async function generateAndPostPixelHost() {
  if (!GEMINI_KEY || !STRAPI_URL || !STRAPI_TOKEN) throw new Error("missing GEMINI_API_KEY / STRAPI_API_URL / STRAPI_TOKEN");

  // 1) pick a category + recent-titles bias
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const recent = await strapi(`post4s?fields[0]=title&sort[0]=createdAt:desc&pagination[pageSize]=40`).catch(() => ({ data: [] }));
  const recentTitles = (recent.data || []).map((a) => a.title).filter(Boolean);

  // 2) brainstorm a fresh, specific topic
  const theme = cat.themes[Math.floor(Math.random() * cat.themes.length)];
  const topic = await gemini(
    `Brainstorm ONE specific, useful article topic for PixelHost, a web-hosting content site, in the "${cat.slug}" category, around: "${theme}". ` +
    `Return only a concise article-title-style topic (no quotes). Avoid anything close to these existing titles:\n${recentTitles.join("\n")}`,
  );

  // 3) full article
  const a = await gemini(
    `You write for PixelHost, an independent web-hosting content site (web hosting, domains, WordPress, website builders). ` +
    `Write a thorough, accurate, plain-language article on: "${topic}" (category: ${cat.slug}). Audience: everyday people, not engineers.\n` +
    `Requirements: 700-1000 words; 1-2 intro paragraphs (type "p") BEFORE any heading; then 4-6 "h2" sections each with 1-3 "p" paragraphs; include at least one "ul" list of 3-6 items; neutral, factual, evergreen; do NOT invent specific prices, brand claims, or statistics. ` +
    `Also: a "description" (~150-char meta description) and 4-6 lowercase "tags". Return JSON per schema.`,
    ARTICLE_SCHEMA,
  );
  if (!a?.title || !Array.isArray(a.sections) || a.sections.length < 3) throw new Error("malformed article from gemini");

  // 4) category + author ids (post4 uses plain `category` / `author` relations)
  const catRes = await strapi(`category4s?filters[slug][$eq]=${encodeURIComponent(cat.slug)}&fields[0]=slug`);
  const categoryId = catRes.data?.[0]?.id;
  const authRes = await strapi(`author4s?fields[0]=name&pagination[pageSize]=50`);
  const authors = authRes.data || [];
  const authorId = authors.length ? authors[Math.floor(Math.random() * authors.length)].id : undefined;

  // 5) unique slug
  let slug = slugify(a.title);
  for (let i = 0; i < 5; i++) {
    const exists = await strapi(`post4s?filters[slug][$eq]=${encodeURIComponent(slug)}&fields[0]=slug`).catch(() => ({ data: [] }));
    if (!(exists.data || []).length) break;
    slug = `${slugify(a.title).slice(0, 70)}-${Math.floor(Math.random() * 9000) + 1000}`;
  }

  // 6) cover image (best-effort)
  const imageId = await findCoverImage(`${cat.slug.replace(/-/g, " ")} ${(a.tags || [])[0] || "technology"}`, `pixelhost-${slug}`);

  // 7) publish
  const payload = {
    data: {
      title: a.title,
      slug,
      description: a.description || "",
      content: sectionsToBlocks(a.sections),
      ...(imageId ? { featuredImage: imageId } : {}),
      ...(categoryId ? { category: categoryId } : {}),
      ...(authorId ? { author: authorId } : {}),
      tags: a.tags || [],
      views: Math.floor(Math.random() * 120) + 20,
      isPopular: false,
    },
  };
  const created = await strapi(`post4s?status=published`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const docId = created?.data?.documentId;
  log(`published "${a.title}" (/${slug}) doc=${docId} img=${imageId || "none"} cat=${categoryId}`);
  return { documentId: docId, title: a.title, slug };
}
