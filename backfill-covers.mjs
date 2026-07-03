/**
 * Backfill AI covers onto content-site articles that are missing featuredImage.
 *
 * Covers are GENERATED via the Gemini API (coverImage.js: Gemini image model ->
 * Imagen fallback) — NOT scraped from the web. Idempotent + re-runnable: only
 * touches articles that still have no cover. Works from EC2 or a local IP.
 *
 * Run:  SITE=all|pixelhost|wpcrew|uxdict node --env-file=.env backfill-covers.mjs
 *   LIMIT=N        cap how many to process this run (default: all missing)
 *   DRYRUN=1       list what would be done, generate nothing
 *   REPLACE=square also re-generate covers that are square (AI 1024x1024) so they
 *                  become native 16:9; leaves non-square (e.g. Openverse) covers alone
 */
import { generateCover } from "./coverImage.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.FILL_GEMINI_MODEL || "gemini-2.5-flash";
const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer "
const SITE = (process.env.SITE || "all").toLowerCase();
const LIMIT = parseInt(process.env.LIMIT || "0", 10) || Infinity;
const DRYRUN = process.env.DRYRUN === "1";
const REPLACE = (process.env.REPLACE || "").toLowerCase(); // "square" -> also redo 1:1 AI covers as 16:9

const SITES = {
  pixelhost: { posts: "post4s", brand: "PixelHost", niche: "web hosting, domains and WordPress", prefix: "pixelhost" },
  wpcrew: { posts: "post5s", brand: "WP Crew", niche: "web design & web development", prefix: "wpcrew" },
  uxdict: { posts: "post6s", brand: "UX Dictionary", niche: "UX/UI design", prefix: "uxdict" },
};
const targets = SITE === "all" ? Object.keys(SITES) : [SITE];
if (targets.some((t) => !SITES[t])) { console.error(`SITE must be all|${Object.keys(SITES).join("|")}`); process.exit(1); }
if (!GEMINI_KEY || !STRAPI_URL || !STRAPI_TOKEN) { console.error("missing GEMINI_API_KEY / STRAPI_API_URL / STRAPI_TOKEN"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function strapi(path, init = {}) {
  const res = await fetch(`${STRAPI_URL}/api/${path}`, { ...init, headers: { Authorization: STRAPI_TOKEN, ...(init.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body?.error || "")}`);
  return body;
}

// Ask Gemini for one concrete cover scene; fall back to a title-based scene.
async function sceneFor(title, cat, cfg) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text:
          `For ${cfg.brand} (${cfg.niche}), write ONE vivid cover-image scene (~35-50 words) whose MAIN SUBJECT literally embodies the article titled "${title}" (category: ${cat}). ` +
          `Name the medium first (modern editorial photograph / clean cinematic 3D render / minimal conceptual illustration), then the main subject, setting, composition and lighting/mood. ` +
          `Tasteful, premium, magazine-cover quality. AVOID whiteboards, sticky notes, documents, books or screens showing text/UI. NO readable text, letters, numbers, logos or watermarks. ` +
          `Return ONLY the sentence, no quotes.` }] }],
        generationConfig: { temperature: 0.9 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json().catch(() => null);
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text && text.length > 20) return text.replace(/^["']|["']$/g, "");
  } catch { /* fall back */ }
  return `A clean, modern editorial cover scene representing "${title}" (${cfg.niche}, category ${cat}) for ${cfg.brand}`;
}

async function run(siteKey) {
  const cfg = SITES[siteKey];
  const all = await strapi(`${cfg.posts}?populate[featuredImage][fields][0]=url&populate[featuredImage][fields][1]=width&populate[featuredImage][fields][2]=height&populate[category][fields][0]=slug&fields[0]=title&fields[1]=slug&pagination[pageSize]=100&status=published`);
  const noCover = (all.data || []).filter((a) => !a.featuredImage);
  const square = REPLACE === "square"
    ? (all.data || []).filter((a) => a.featuredImage && a.featuredImage.width && a.featuredImage.width === a.featuredImage.height)
    : [];
  const missing = [...noCover, ...square];
  console.log(`\n=== ${siteKey} (${cfg.posts}): ${all.data.length} articles, ${noCover.length} missing${REPLACE === "square" ? ` + ${square.length} square-to-redo` : ""} ===`);
  let ok = 0, fail = 0, n = 0;
  for (const a of missing) {
    if (n >= LIMIT) { console.log(`  (LIMIT ${LIMIT} reached)`); break; }
    n++;
    const cat = a.category?.slug || "general";
    process.stdout.write(`  [${n}] ${a.slug.slice(0, 56)} (${cat}) ... `);
    if (DRYRUN) { console.log("DRYRUN"); continue; }
    try {
      const scene = await sceneFor(a.title, cat, cfg);
      const { id, src } = await generateCover({ scene, prefix: `${cfg.prefix}-${a.slug}` });
      if (!id) { fail++; console.log("FAIL (no image)"); continue; }
      await strapi(`${cfg.posts}/${a.documentId}?status=published`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { featuredImage: id } }),
      });
      ok++;
      console.log(`OK img=${src}#${id}`);
    } catch (e) {
      fail++;
      console.log(`FAIL: ${e.message}`);
    }
    await sleep(1200);
  }
  console.log(`  ${siteKey} done: ${ok} filled, ${fail} failed`);
  return { ok, fail, missing: missing.length };
}

let totalOk = 0, totalFail = 0;
for (const t of targets) { const r = await run(t); totalOk += r.ok; totalFail += r.fail; }
console.log(`\nALL DONE: ${totalOk} covers filled, ${totalFail} failed`);
