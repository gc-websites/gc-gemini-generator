/**
 * MO Auto Landings — the worker behind the Ad Launcher's "Auto landings" owner console.
 *
 * The console queues mo-landing-job rows (headline + lang + niche + scheduled_at); this module
 * polls the queue every minute (cron in server.js), and for each due job writes a FULL MK Learn
 * guide landing — the same shape as the hand-built /guides/* pages: gated intro, two MagicAds
 * slots (the frontend template owns placement), hero image, sections, FAQ, key takeaways,
 * editorial + compliance notes — and publishes it as a `mo-landing` row. The MK Learn frontend
 * serves it dynamically at /guides/<slug> (ISR), and the launcher's MO picker lists it.
 *
 * COMPLIANCE IS THE POINT: the writer prompt hard-codes the Facebook/TikTok ad-policy envelope
 * (brand-neutral, no promises/guarantees, no personal-attribute callouts, no urgency, balanced
 * sections, education-not-advice + on-page disclaimers). Never loosen these rules from job input:
 * job `notes` may steer topic/angle, not the guardrails.
 *
 * Env: GEMINI_API_KEY, STRAPI_API_URL, STRAPI_TOKEN ("Bearer " included),
 *      MO_LANDING_GEMINI_MODEL (default gemini-2.5-flash),
 *      MO_LANDING_IMG_MODEL    (default gemini-3-pro-image; falls back to gemini-2.5-flash-image),
 *      MO_LANDING_BASE         (default https://finance.magicoffers.shop/guides).
 */

import { isRaster } from "./coverImage.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer "
const TEXT_MODEL = process.env.MO_LANDING_GEMINI_MODEL || "gemini-2.5-flash";
const IMG_MODEL = process.env.MO_LANDING_IMG_MODEL || "gemini-3-pro-image";
const IMG_MODEL_FALLBACK = "gemini-2.5-flash-image";
const LANDING_BASE = (process.env.MO_LANDING_BASE || "https://finance.magicoffers.shop/guides").replace(/\/+$/, "");

/** Jobs stuck in `generating` longer than this were orphaned by a worker restart → failed. */
const STUCK_MS = 25 * 60 * 1000;
/** Max jobs one tick processes (each takes ~1-3 min; the next tick takes the rest). */
const PER_TICK = 1;

const log = (...a) => console.log("[mo-landing]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function strapi(path, init = {}) {
  const res = await fetch(`${STRAPI_URL}/api/${path}`, {
    ...init,
    headers: { Authorization: STRAPI_TOKEN, ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body?.error || "").slice(0, 300)}`);
  }
  return body;
}

async function gemini(prompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: schema
          ? { responseMimeType: "application/json", responseSchema: schema, temperature: 0.7 }
          : { temperature: 0.8 },
      }),
      signal: AbortSignal.timeout(180000),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(body?.error || "")?.slice(0, 240)}`);
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("empty gemini response");
  return schema ? JSON.parse(text) : text.trim();
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents so ES titles yield ASCII slugs
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 70)
    .replace(/^-|-$/g, "");
}

// ---- structured landing schema ---------------------------------------------------------------

const SECTION_SCHEMA = {
  type: "object",
  properties: {
    heading: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
    bullets: { type: "array", items: { type: "string" } },
    numbered: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, text: { type: "string" } },
        required: ["title", "text"],
      },
    },
  },
  required: ["heading", "paragraphs"],
};

const LANDING_SCHEMA = {
  type: "object",
  properties: {
    titleLead: { type: "string" },
    titleAccent: { type: "string" },
    categoryLabel: { type: "string" },
    subtitle: { type: "string" },
    metaDescription: { type: "string" },
    rowTitle: { type: "string" },
    heroPrompt: { type: "string" },
    heroAlt: { type: "string" },
    intro: { type: "array", items: { type: "string" } },
    sections: { type: "array", items: SECTION_SCHEMA },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: { q: { type: "string" }, a: { type: "string" } },
        required: ["q", "a"],
      },
    },
    takeaways: { type: "array", items: { type: "string" } },
    compliance: { type: "string" },
  },
  required: [
    "titleLead", "titleAccent", "categoryLabel", "subtitle", "metaDescription", "rowTitle",
    "heroPrompt", "heroAlt", "intro", "sections", "faq", "takeaways", "compliance",
  ],
};

/** The ad-policy envelope every generated page must live inside. NEVER weakened by job input. */
const COMPLIANCE_RULES = `
HARD COMPLIANCE RULES (Facebook + TikTok ad policies — the article is an ad landing page):
- Purely educational/informational. Never personalized advice. No financial, medical or legal advice.
- BRAND-NEUTRAL: never name or imply any company, brand, product name, government program/agency,
  institution or public figure. No "official", no implied affiliation or endorsement.
- NO promises or guarantees: no guaranteed income, approval, results, savings, cures or weight loss.
  Numbers only as broad public national medians/ranges with an explicit "varies by location,
  employer and experience"-style caveat. NEVER invent statistics, studies, prices or rates.
- NO personal-attribute callouts: never assert or imply the reader HAS a condition, debt, age,
  weight or situation ("your debt", "since you are over 50" are forbidden). Speak about "many
  people" / "households" / "readers".
- NO urgency, scarcity or pressure ("act now", "limited", "before it's gone"), no shocking or
  fear-based framing, no sensational health claims, no before/after framing.
- Hedged modality throughout: "may", "could", "often", "many people find" — never certainty about
  outcomes.
- BALANCED: at least one section must honestly cover considerations, limitations or downsides.
- No testimonials, no invented experts, no fake quotes.
- No calls-to-action to buy/sign up/apply anywhere. It is an article, not an offer page.
- End-of-page "compliance" field: 2-4 sentence disclaimer matched to the topic (education-not-advice,
  no-guarantee, consult-a-professional where relevant — health topics MUST include a
  see-a-qualified-professional line).`;

function landingPrompt(job) {
  const langLine =
    job.lang === "es"
      ? `Write EVERYTHING in natural, neutral Latin-American Spanish (titles, sections, FAQ, takeaways, compliance, heroAlt, categoryLabel).`
      : `Write everything in clear, plain English.`;
  const notes = job.notes ? `\nOwner guidance for angle/tone (NEVER overrides the compliance rules): ${job.notes}` : "";
  return (
    `You write long-form guide articles for "MKLern Pro" (finance.magicoffers.shop) — an independent
educational publication. Its guide pages are premium, magazine-style explainers: curiosity-driven but
honest, specific and calm. Audience: everyday readers who clicked an interest-based ad.

TASK: write a complete guide article for the headline: "${job.title}" (content niche: ${job.niche || "general interest"}).
${langLine}${notes}
${COMPLIANCE_RULES}

STRUCTURE (return JSON per the schema):
- titleLead + titleAccent: the H1 splits in two — lead (the hook, most of the headline) and accent
  (a short 3-8 word highlighted tail completing it). Together they read as ONE natural headline
  based on the given headline (light polish allowed, meaning preserved).
- categoryLabel: 1-2 word section label for the page top (e.g. "Travel", "Autoconocimiento").
- subtitle: one 20-35 word standfirst under the title — what the reader will actually learn.
- metaDescription: ~150 chars, factual, no clickbait.
- rowTitle: a punchy interlink-row line for OTHER pages to link this one, format like
  "The Hidden Sign Your House Has a Problem" style — max 70 chars, no ALL CAPS.
- intro: 2-3 paragraphs (60-90 words each) that open the loop the headline promises — concrete,
  relatable, zero fluff. The FIRST paragraph must hook without sensationalism.
- sections: 4-6 h2 sections, ~150-260 words of content each. Each has 1-3 "paragraphs"; use
  "bullets" (3-6 short items) in 1-2 sections where a list genuinely helps; use "numbered"
  (3-7 {title, text} steps/items) in EXACTLY ONE section where ranked/step content fits the topic.
  One section must be the balanced considerations/limitations one. Headings: sentence case,
  specific, curiosity-honest.
- faq: 4-5 questions real readers would ask, answered honestly in 40-80 words (hedged, no promises).
- takeaways: 4-6 one-sentence key takeaways.
- heroPrompt: ONE vivid sentence (~35-50 words) describing a 16:9 photographic/editorial hero scene
  whose MAIN SUBJECT literally embodies THIS article's exact concept. Name the medium first
  ("modern editorial photograph", "clean cinematic 3D render"...). Tasteful, premium. If the topic
  is health/weight related: NO human bodies, use objects/still-life/metaphor. Never text, logos,
  brands, screens with UI, or celebrity likeness in the scene.
- heroAlt: a 10-20 word factual alt text for that image.
- compliance: the end-of-page disclaimer per the rules above.

Total article length target: 1300-1800 words. Concrete examples over generalities. Return JSON only.`
  );
}

// ---- validation of the generated structure ---------------------------------------------------

const str = (v, max = 4000) => String(v ?? "").trim().slice(0, max);
const strArr = (v, maxItems, maxLen = 2000) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems);

/** Normalize + sanity-check Gemini's landing JSON; throws when structurally unusable. */
export function normalizeLanding(a) {
  const out = {
    titleLead: str(a?.titleLead, 200),
    titleAccent: str(a?.titleAccent, 160),
    categoryLabel: str(a?.categoryLabel, 40) || "Guide",
    subtitle: str(a?.subtitle, 400),
    metaDescription: str(a?.metaDescription, 300),
    rowTitle: str(a?.rowTitle, 90),
    heroPrompt: str(a?.heroPrompt, 700),
    heroAlt: str(a?.heroAlt, 250),
    intro: strArr(a?.intro, 4),
    sections: (Array.isArray(a?.sections) ? a.sections : [])
      .map((s) => ({
        heading: str(s?.heading, 200),
        paragraphs: strArr(s?.paragraphs, 5),
        bullets: strArr(s?.bullets, 8, 400),
        numbered: (Array.isArray(s?.numbered) ? s.numbered : [])
          .map((n) => ({ title: str(n?.title, 160), text: str(n?.text, 900) }))
          .filter((n) => n.title && n.text)
          .slice(0, 8),
      }))
      .filter((s) => s.heading && (s.paragraphs.length || s.bullets.length || s.numbered.length))
      .slice(0, 8),
    faq: (Array.isArray(a?.faq) ? a.faq : [])
      .map((f) => ({ q: str(f?.q, 250), a: str(f?.a, 900) }))
      .filter((f) => f.q && f.a)
      .slice(0, 6),
    takeaways: strArr(a?.takeaways, 7, 400),
    compliance: str(a?.compliance, 1200),
  };
  if (!out.titleLead || !out.titleAccent) throw new Error("landing missing title parts");
  if (out.intro.length < 1) throw new Error("landing missing intro");
  if (out.sections.length < 3) throw new Error(`landing too thin: ${out.sections.length} sections`);
  if (out.faq.length < 2) throw new Error("landing missing FAQ");
  if (out.takeaways.length < 3) throw new Error("landing missing takeaways");
  if (!out.compliance) throw new Error("landing missing compliance note");
  return out;
}

// ---- hero image ------------------------------------------------------------------------------

async function uploadImage(buf, mime, name) {
  const ct = (mime || "image/jpeg").split(";")[0];
  const form = new FormData();
  form.append("files", new Blob([buf], { type: ct }), `${name}.${ct.includes("png") ? "png" : "jpg"}`);
  const up = await fetch(`${STRAPI_URL}/api/upload`, {
    method: "POST",
    headers: { Authorization: STRAPI_TOKEN },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const ub = await up.json().catch(() => null);
  if (up.ok && ub?.[0]?.id) return ub[0].id;
  throw new Error(`strapi upload failed (${up.status})`);
}

function heroEnvelope(scene) {
  return (
    `${scene} FULL-BLEED wide 16:9 hero: the scene fills the ENTIRE frame edge to edge, no borders, ` +
    `no letterboxing. High-end professional magazine-cover quality, sharp focus, beautiful natural ` +
    `lighting, cohesive limited color palette, depth and atmosphere, tasteful and uncluttered. ` +
    `Absolutely NO text, words, letters, numbers, captions, logos, watermarks, brand marks, UI ` +
    `screenshots or recognizable people anywhere in the image.`
  );
}

/** gemini-3-pro-image 16:9 2K → fallback flash-image. Returns Strapi media id (or null). */
async function generateHero(scene, prefix) {
  const prompt = heroEnvelope(scene);
  const models = [
    { model: IMG_MODEL, config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } },
    { model: IMG_MODEL_FALLBACK, config: { responseModalities: ["IMAGE"] } },
  ];
  for (const { model, config } of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: config }),
            signal: AbortSignal.timeout(180000),
          },
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`img ${model} ${res.status}`);
        const inline = (body?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData)?.inlineData;
        if (!inline?.data) throw new Error("no image in response");
        const buf = Buffer.from(inline.data, "base64");
        if (buf.length < 20000 || !isRaster(buf)) throw new Error("undersized/non-raster image");
        const id = await uploadImage(buf, inline.mimeType, prefix);
        log(`hero via ${model} (${Math.round(buf.length / 1024)}KB) -> media ${id}`);
        return id;
      } catch (e) {
        log(`hero attempt failed (${model}): ${e.message}`);
        await sleep(2500);
      }
    }
  }
  return null;
}

// ---- slug ------------------------------------------------------------------------------------

/** Slug free = no mo-landing row AND the live site 404s it (catches the STATIC /guides pages). */
async function slugTaken(slug) {
  const rows = await strapi(`mo-landings?filters[slug][$eq]=${encodeURIComponent(slug)}&fields[0]=slug&pagination[pageSize]=1`);
  if ((rows.data || []).length > 0) return true;
  try {
    const res = await fetch(`${LANDING_BASE}/${slug}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    return res.status < 400; // 200/3xx = an existing page answers there
  } catch {
    return false; // site unreachable → trust the registry check
  }
}

/**
 * Purge the page's ISR cache after publishing, then warm it. The slug-collision HEAD probe
 * above renders the not-yet-existing page and CACHES its 404 (route + data cache re-serve each
 * other's stale entry well past `revalidate`) — without this purge a fresh landing can stay 404
 * for many minutes. Auth = the same Strapi bearer both sides already hold. Non-fatal: on failure
 * the page eventually heals via ISR, so the job still counts as published.
 */
async function revalidateLanding(slug) {
  const origin = LANDING_BASE.replace(/\/guides$/, "");
  const bearer = STRAPI_TOKEN.startsWith("Bearer ") ? STRAPI_TOKEN : `Bearer ${STRAPI_TOKEN}`;
  try {
    const res = await fetch(`${origin}/api/revalidate`, {
      method: "POST",
      headers: { Authorization: bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ path: `/guides/${slug}` }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`revalidate ${res.status}`);
  } catch (e) {
    log(`revalidate failed for ${slug}: ${e.message} (page will heal via ISR)`);
    return false;
  }
  // Warm + verify: the first GET renders fresh; retry a couple of times for slow cold renders.
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${LANDING_BASE}/${slug}`, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        log(`landing live: ${LANDING_BASE}/${slug} (${res.status})`);
        return true;
      }
    } catch {
      /* retry */
    }
    await sleep(2500);
  }
  log(`landing still not 200 after revalidate: ${slug}`);
  return false;
}

async function uniqueSlug(title) {
  const base = slugify(title) || `guide-${Date.now().toString(36)}`;
  if (!(await slugTaken(base))) return base;
  for (let i = 0; i < 5; i++) {
    const cand = `${base.slice(0, 62)}-${Math.floor(Math.random() * 9000) + 1000}`;
    if (!(await slugTaken(cand))) return cand;
  }
  throw new Error(`could not find a free slug for "${base}"`);
}

// ---- one job ---------------------------------------------------------------------------------

/** Generate + publish one landing for a claimed job. Returns { slug, url, title }. */
export async function generateMoLanding(job) {
  if (!GEMINI_KEY || !STRAPI_URL || !STRAPI_TOKEN) {
    throw new Error("missing GEMINI_API_KEY / STRAPI_API_URL / STRAPI_TOKEN");
  }
  const raw = await gemini(landingPrompt(job), LANDING_SCHEMA);
  const a = normalizeLanding(raw);
  const slug = await uniqueSlug(`${a.titleLead} ${a.titleAccent}`.slice(0, 90) || job.title);

  const heroScene =
    a.heroPrompt && a.heroPrompt.length > 20
      ? a.heroPrompt
      : `A premium editorial photograph representing "${job.title}"`;
  const heroId = await generateHero(heroScene, `mo-landing-${slug}`);

  const payload = {
    data: {
      title: a.titleLead,
      title_accent: a.titleAccent,
      slug,
      lang: job.lang === "es" ? "es" : "en",
      niche: job.niche || "Auto",
      category_label: a.categoryLabel,
      subtitle: a.subtitle,
      description: a.metaDescription,
      row_title: a.rowTitle || `${a.titleLead}`.slice(0, 88),
      ...(heroId ? { hero: heroId } : {}),
      hero_alt: a.heroAlt || a.titleLead,
      content: { intro: a.intro, sections: a.sections },
      faq: a.faq,
      takeaways: a.takeaways,
      compliance: a.compliance,
      created_by: job.created_by || "",
      job_id: job.documentId,
    },
  };
  const created = await strapi(`mo-landings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const docId = created?.data?.documentId;
  const url = `${LANDING_BASE}/${slug}`;
  log(`published "${a.titleLead}" -> ${url} (doc=${docId}, hero=${heroId || "none"})`);
  await revalidateLanding(slug);
  return { slug, url, title: `${a.titleLead} ${a.titleAccent}`.trim() };
}

// ---- the queue worker ------------------------------------------------------------------------

async function patchJob(documentId, data) {
  await strapi(`mo-landing-jobs/${documentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
}

/**
 * One worker tick: heal orphaned rows, then claim + process up to PER_TICK due jobs.
 * `notify(text)` is optional (Telegram). Designed for a 1-minute cron with an isRunning latch
 * in server.js — a single worker instance, so claim = a simple status flip.
 */
export async function runMoLandingWorker(notify) {
  if (!STRAPI_URL || !STRAPI_TOKEN) return { processed: 0 };
  const now = Date.now();

  // Self-heal: a worker restart mid-generation leaves rows in `generating` forever.
  try {
    const stuck = await strapi(
      `mo-landing-jobs?filters[status][$eq]=generating&filters[started_at][$lt]=${now - STUCK_MS}&pagination[pageSize]=10`,
    );
    for (const row of stuck.data || []) {
      log(`healing stuck job ${row.documentId} ("${row.title}")`);
      await patchJob(row.documentId, {
        status: "failed",
        error: "worker restarted mid-generation — hit Retry",
        finished_at: String(Date.now()),
      }).catch(() => {});
    }
  } catch (e) {
    log(`stuck-sweep failed: ${e.message}`);
  }

  let due;
  try {
    due = await strapi(
      `mo-landing-jobs?filters[status][$eq]=scheduled&filters[scheduled_at][$lte]=${now}` +
        `&sort[0]=scheduled_at:asc&pagination[pageSize]=${PER_TICK}`,
    );
  } catch (e) {
    log(`due-query failed: ${e.message}`);
    return { processed: 0 };
  }

  let processed = 0;
  for (const row of due.data || []) {
    const job = row;
    try {
      await patchJob(job.documentId, {
        status: "generating",
        started_at: String(Date.now()),
        attempts: (Number(job.attempts) || 0) + 1,
        error: "",
      });
    } catch (e) {
      log(`claim failed for ${job.documentId}: ${e.message}`);
      continue;
    }
    try {
      log(`generating "${job.title}" (${job.lang || "en"}, ${job.niche || "Auto"})…`);
      const res = await generateMoLanding(job);
      await patchJob(job.documentId, {
        status: "published",
        slug: res.slug,
        landing_url: res.url,
        finished_at: String(Date.now()),
        error: "",
      });
      processed++;
      if (notify) {
        await notify(
          `⭐️ AUTO LANDING ⭐️\n✅ MK Learn ✅\n\nTitle: ${res.title}\n\n${res.url}\n\nIt is live in the MO landing picker.`,
        ).catch(() => {});
      }
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 800);
      log(`job ${job.documentId} FAILED: ${msg}`);
      await patchJob(job.documentId, {
        status: "failed",
        error: msg,
        finished_at: String(Date.now()),
      }).catch(() => {});
      if (notify) {
        await notify(`❌ AUTO LANDING failed\n\n"${job.title}"\n${msg}\n\nRetry from the Auto landings console.`).catch(() => {});
      }
    }
  }
  return { processed };
}
