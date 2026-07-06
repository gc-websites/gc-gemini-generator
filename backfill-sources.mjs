/**
 * Backfill "Sources & Further Reading" into existing pixelhost / wpcrew /
 * uxdictionary articles that have no external links yet.
 *
 * For each article: Gemini proposes authoritative references, every URL is
 * HTTP-validated (sourceLinks.js), 3-5 survivors are appended as a linked
 * Sources section + up to 2 woven inline. Idempotent: articles that already
 * contain any link or the Sources heading are skipped.
 *
 * Run:  node --env-file=.env backfill-sources.mjs [pixelhost|wpcrew|uxdictionary|all] [--limit N] [--dry]
 */

import {
  buildValidatedSources,
  sourcesToBlocks,
  weaveInlineLinks,
  blocksHaveLinks,
  SOURCES_HEADING,
} from "./sourceLinks.js";

const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer " prefix

const SITES = {
  pixelhost: {
    posts: "post4s",
    ctx: "PixelHost, an independent plain-language web-hosting content site (hosting, domains, WordPress, website builders)",
  },
  wpcrew: {
    posts: "post5s",
    ctx: "WP Crew, an independent web design & web development content site (web design, front-end development, UX/UI, no-code, freelancing)",
  },
  uxdictionary: {
    posts: "post6s",
    ctx: "UX Dictionary, an independent UX/UI design publication (UX design, UI & visual design, UX research, design systems)",
  },
};

const argSite = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "all";
const limitIx = process.argv.indexOf("--limit");
const LIMIT = limitIx > -1 ? parseInt(process.argv[limitIx + 1], 10) || Infinity : Infinity;
const DRY = process.argv.includes("--dry");

if (argSite !== "all" && !SITES[argSite]) {
  console.error(`unknown site "${argSite}" (pixelhost|wpcrew|uxdictionary|all)`);
  process.exit(1);
}
if (!STRAPI_URL || !STRAPI_TOKEN || !process.env.GEMINI_API_KEY) {
  console.error("missing STRAPI_API_URL / STRAPI_TOKEN / GEMINI_API_KEY");
  process.exit(1);
}

async function strapi(path, init = {}) {
  const res = await fetch(`${STRAPI_URL}/api/${path}`, {
    ...init,
    headers: { Authorization: STRAPI_TOKEN, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body?.error || "")}`);
  return body;
}

function hasSourcesHeading(blocks) {
  return (blocks || []).some(
    (b) => b.type === "heading" && (b.children || []).some((c) => (c.text || "").includes(SOURCES_HEADING)),
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function backfillSite(key) {
  const site = SITES[key];
  console.log(`\n=== ${key} (${site.posts}) ===`);
  let page = 1;
  const articles = [];
  while (true) {
    const res = await strapi(
      `${site.posts}?fields[0]=title&fields[1]=slug&fields[2]=description&fields[3]=content&pagination[page]=${page}&pagination[pageSize]=100&sort[0]=createdAt:asc`,
    );
    articles.push(...(res.data || []));
    const pg = res.meta?.pagination;
    if (!pg || page >= pg.pageCount) break;
    page++;
  }
  console.log(`fetched ${articles.length} articles`);

  let updated = 0, skipped = 0, failed = 0;
  for (const a of articles) {
    if (updated >= LIMIT) break;
    const content = Array.isArray(a.content) ? a.content : [];
    if (blocksHaveLinks(content) || hasSourcesHeading(content)) {
      skipped++;
      continue;
    }
    try {
      const sources = await buildValidatedSources({
        title: a.title,
        summary: a.description || "",
        siteContext: site.ctx,
      });
      if (sources.length === 0) {
        console.log(`~ "${a.slug}": 0 validated sources, leaving untouched`);
        failed++;
        continue;
      }
      const inline = weaveInlineLinks(content, sources, 2);
      const newContent = [...content, ...sourcesToBlocks(sources)];
      if (DRY) {
        console.log(`DRY "${a.slug}": would add ${sources.length} sources (${inline} inline): ${sources.map((s) => s.url).join(" | ")}`);
      } else {
        await strapi(`${site.posts}/${a.documentId}?status=published`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { content: newContent } }),
        });
        console.log(`+ "${a.slug}": ${sources.length} sources (${inline} inline)`);
      }
      updated++;
      await sleep(400);
    } catch (e) {
      failed++;
      console.error(`! "${a.slug}": ${e.message}`);
      await sleep(1500);
    }
  }
  console.log(`${key} done: ${updated} updated, ${skipped} skipped (already linked), ${failed} failed`);
  return { updated, skipped, failed };
}

const keys = argSite === "all" ? Object.keys(SITES) : [argSite];
const totals = { updated: 0, skipped: 0, failed: 0 };
for (const k of keys) {
  const r = await backfillSite(k);
  totals.updated += r.updated;
  totals.skipped += r.skipped;
  totals.failed += r.failed;
}
console.log(`\nTOTAL: ${totals.updated} updated, ${totals.skipped} skipped, ${totals.failed} failed`);
