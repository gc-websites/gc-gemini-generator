/**
 * MO Auto Landings — the "job-style guide" (JobGuide) format. PURE module: no I/O, no env reads.
 *
 * The worker (functionsMoLanding.js) runs TWO Gemini calls per job — (1) the article body,
 * (2) the funnel copy for the deterministically chosen interlinks — and this module owns the
 * schemas + prompts for both, the interlink selection over the site catalog, the normalizers and
 * the assembly of the final `JobGuideContent` JSON (MKLearn `lib/funnel/jobguide.ts`) that is
 * stored in `mo-landing.content` for `format: "jobguide"` rows.
 *
 * Contract: scratchpad jobguide-contract.md §3 (content JSON), §4 (compliance), §6 (interlinks).
 */

// ---- compliance envelope --------------------------------------------------------------------

/** The ad-policy envelope every generated page must live inside. NEVER weakened by job input. */
export const COMPLIANCE_RULES = `
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

/** Extras for the job-style template (contract §4) — same spirit, template-specific. */
export const JOBGUIDE_TEMPLATE_RULES = `
TEMPLATE-SPECIFIC RULES for the job-style guide (in addition to the rules above, never weakened):
- Every number in the overview table and the reference table is an "indicative national range"
  (use "~", "typically", "indicative") and the table's intro or benefits paragraph MUST carry a
  caveat line ("indicative ranges, vary by ..., not offers").
- The callout is ALWAYS an anti-advance-fee-scam warning matched to the topic ("★ Never pay
  upfront ..." style): legitimate employers/lenders/providers never ask for money, gift cards or
  transfers before delivering; treat any such request as a scam and walk away.
- The "compliance" disclaimer above maps to the \`disclaimer\` field here: \`disclaimer.lead\` is a
  1-2 word label ("Disclaimer:" / "Aviso:"), \`disclaimer.text\` is the 2-4 sentence disclaimer.
- The page has in-page anchor jumps only (to its own sections). Never write "Apply now", never
  point to an offer, form or third party. Nothing on the page sells or signs anybody up.
- Neutral, calm tone everywhere. No urgency, no countdowns, no "spots left".`;

/** Non-job topics: how the template's job-shaped sections map (contract §3). */
export const TOPIC_MAPPING = `
SECTION SEMANTICS (job vacancies read literally; for ANY other topic map the sections like this):
- overview = "at a glance" table: 6-8 label/value rows summarising the topic (type, where, typical
  amounts/pay/time, who it is for, requirements, how to start ...).
- where = where the thing happens / who provides it (2-3 paragraphs, brand-neutral).
- duties = what the practice/process actually involves (5-7 items + a short outro).
- roles = the topic's signature list: main types/variants/roles (5-6 {name, text}).
- eligibility = who qualifies / requirements (5-6 items).
- documents = information and documents typically needed (5-7 items).
- salary = the topic's reference table: 3 columns, 4-6 rows, indicative ranges only (pay bands,
  rate bands, cost bands, timelines ...) + benefitsLead/benefits = what a good outcome usually
  includes, ending with the caveat sentence.
- callout = the anti-advance-fee-scam warning matched to the topic.
- apply = step-by-step (5-7 concrete steps) to get started properly.
- find = where to look: legitimate channels only (4-5 items).
- growth = what improves over time / how to progress (4-5 items).
- example = an EXPLICITLY illustrative worked example ("Imagine a reader who ..."), no real people.
- mistakes = 5-6 common mistakes to avoid.
- rights = reader rights/privacy + common scam patterns (exactly 2 paragraphs).
- faq = 5-7 questions real readers ask, answered honestly (40-80 words, hedged).
- conclusion = a calm 80-120 word wrap-up. disclaimer = lead + text as described above.`;

// ---- schema helpers (Gemini responseSchema = OpenAPI subset: no tuples, string enums only) ----

const S = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties) });
const arr = (items, minItems, maxItems) => ({ type: "array", items, minItems, maxItems });

export const JOBGUIDE_ARTICLE_SCHEMA = obj({
  title: S,
  titleAccent: S,
  category: S,
  description: S,
  rowTitle: S,
  quiz: obj({
    steps: arr(obj({ question: S, options: arr(S, 3, 3) }), 3, 3),
    rewardsTitle: S,
    rewardsHint: S,
    tapLabel: S,
  }),
  intro: arr(S, 3, 3),
  guideSummary: S,
  overview: obj({ heading: S, intro: S, rows: arr(obj({ label: S, value: S }), 6, 8) }),
  where: obj({ heading: S, paras: arr(S, 2, 3) }),
  duties: obj({ heading: S, intro: S, items: arr(S, 5, 7), outro: S }),
  roles: obj({ heading: S, intro: S, items: arr(obj({ name: S, text: S }), 5, 6) }),
  eligibility: obj({ id: S, heading: S, intro: S, items: arr(S, 5, 6) }),
  documents: obj({ heading: S, intro: S, items: arr(S, 5, 7) }),
  salary: obj({
    id: S,
    heading: S,
    intro: S,
    columns: arr(S, 3, 3),
    rows: arr(obj({ cells: arr(S, 3, 3) }), 4, 6),
    benefitsLead: S,
    benefits: S,
  }),
  callout: obj({ lead: S, text: S }),
  apply: obj({ id: S, heading: S, steps: arr(S, 5, 7) }),
  find: obj({ heading: S, intro: S, items: arr(S, 4, 5) }),
  growth: obj({ heading: S, intro: S, items: arr(S, 4, 5) }),
  example: obj({ heading: S, text: S }),
  mistakes: obj({ heading: S, items: arr(S, 5, 6) }),
  rights: obj({ heading: S, paras: arr(S, 2, 2) }),
  faq: obj({ heading: S, items: arr(obj({ q: S, a: S }), 5, 7) }),
  conclusion: obj({ heading: S, text: S }),
  disclaimer: obj({ lead: S, text: S }),
  imagePrompt: S,
  imageAlt: S,
  imageCaption: S,
});

const TONES = ["none", "green", "purple", "yellow"];

/**
 * Base funnel schema (slug fields unconstrained). Use `funnelSchemaFor(links)` for the enum'd one.
 * NO minItems/maxItems here on purpose: Gemini rejects "enum × array bounds" as "too many states
 * for serving" (verified 2026-09-14); the counts live in the prompt and the normalizer/assembler
 * enforce the tuple sizes anyway.
 */
export const JOBGUIDE_FUNNEL_SCHEMA = obj({
  pillCopy: arr(obj({ slug: S, title: S, sub: S })),
  promoCopy: arr(obj({ slug: S, heading: S, text: S, button: S })),
  cardCopy: arr(obj({ slug: S, title: S, excerpt: S })),
  tags: arr(obj({ label: S, slug: S })),
  scrollBox: obj({
    headline: arr(S),
    pill1: S,
    body: arr(obj({ text: S, tone: { type: "string", enum: TONES } })),
    pill2: arr(S),
  }),
  stickyBar: obj({ text: S, button: S }),
  cta1Label: S,
  cta2Label: S,
  cta3Label: S,
  relatedHeading: S,
  recentHeading: S,
  tagsHeading: S,
});

/** The funnel schema with every `slug` constrained to the slugs actually offered to Gemini. */
export function funnelSchemaFor(links) {
  const allowed = uniq([
    ...(links.pills || []),
    ...(links.promos || []),
    ...(links.cards || []),
    ...(links.tagSlugs || []),
  ].map((g) => (typeof g === "string" ? g : g.slug)).filter(Boolean));
  const schema = JSON.parse(JSON.stringify(JOBGUIDE_FUNNEL_SCHEMA));
  const slugEnum = { type: "string", enum: allowed };
  for (const key of ["pillCopy", "promoCopy", "cardCopy", "tags"]) {
    schema.properties[key].items.properties.slug = slugEnum;
  }
  return schema;
}

// ---- prompts --------------------------------------------------------------------------------

function langLine(lang) {
  return lang === "es"
    ? `LANGUAGE: write EVERY field in natural, neutral Latin-American Spanish (no regionalisms), for readers living in the United States — US context, amounts in USD ("$"), US institutions described generically. Address the reader informally as «tú» (never «usted»), like the site's other Spanish guides.`
    : `LANGUAGE: write every field in clear, plain US English; amounts in USD ("$").`;
}

export function buildArticlePrompt(job) {
  const lang = job.lang === "es" ? "es" : "en";
  const notes = job.notes
    ? `\nOwner guidance for the ANGLE only (never overrides any rule below): ${String(job.notes).slice(0, 600)}`
    : "";
  const idHint =
    lang === "es"
      ? `e.g. "quien-califica", "tabla-clave", "como-empezar"`
      : `e.g. "who-qualifies", "key-facts-table", "how-to-start"`;
  return `You write long-form guide articles for "MKLern Pro" (finance.magicoffers.shop) — an independent
educational publication. This article uses the "job-style guide" template: a structured, service-journalism
explainer (at-a-glance table, what it involves, main types, who qualifies, documents, a reference table,
numbered steps, where to look, growth, a worked example, mistakes, rights & scam patterns, FAQ, conclusion,
disclaimer). Audience: everyday readers who clicked an interest-based ad. Tone: premium, calm, specific,
honest — never salesy.

TASK: write the complete article for the headline: "${job.title}" (content niche: ${job.niche || "general interest"}).
${langLine(lang)}${notes}
${COMPLIANCE_RULES}
${JOBGUIDE_TEMPLATE_RULES}
${TOPIC_MAPPING}

FIELDS (return JSON per the schema; every field is required):
- title + titleAccent: the H1 splits in two — title = the lead (the hook, most of the headline),
  titleAccent = a short highlighted tail starting with "– " (en dash) that completes it, e.g.
  title "Warehouse jobs in 2026", titleAccent "– Openings, pay & how to apply". Together they read as
  ONE natural headline based on the given headline (light polish allowed, meaning preserved).
- category: 1-3 word breadcrumb/tag category (e.g. "Jobs & careers", "Autos y financiamiento").
- description: meta description, ~150-160 chars, factual, no clickbait.
- rowTitle: a punchy interlink-row line for OTHER pages to link this one, max 70 chars, no ALL CAPS.
- quiz: 3 entry-gate questions × exactly 3 short options each, about the reader's interest/situation
  in a neutral way (what they are looking for, how soon, which type ...) — never about protected
  attributes (age, health, finances, ethnicity, religion ...). rewardsTitle = what is being prepared
  ("Finding the best options for you" style), rewardsHint = one sentence: watch a short ad to see the
  details, tapLabel = a 2-4 word button label ("See the details").
- intro: exactly 3 paragraphs (55-85 words each) that open the loop the headline promises — concrete,
  relatable, zero fluff, no sensationalism.
- guideSummary: ONE 60-90 word paragraph starting with "This complete guide explains ..." (es: "Esta
  guía completa explica ...") listing what the reader will learn + the indicative-ranges caveat.
- overview / where / duties / roles / eligibility / documents / salary / callout / apply / find / growth /
  example / mistakes / rights / faq / conclusion / disclaimer: per the section semantics above. Headings:
  sentence case, specific. Table cells short (2-10 words). List items are full sentences or crisp
  fragments (8-25 words). salary.columns = exactly 3 column headers; each salary row = exactly 3 cells.
- eligibility.id, salary.id, apply.id: three DIFFERENT short ASCII kebab-case anchor ids in the
  article language (2-3 words, lowercase, no accents), ${idHint}.
- imagePrompt: ONE ~40-word description of a wide 16:9 editorial photograph whose main subject
  literally embodies THIS topic (name the medium first: "Editorial photograph of ..."). Tasteful,
  premium, real-world scene. NO text, words, logos, brands, UI screens, celebrity likeness or
  recognizable faces. Health/body topics: objects and still-life only, no human bodies.
- imageAlt: 10-20 word factual alt text. imageCaption: one 12-25 word caption under the photo.

LENGTH: at least 2,300 words of body copy (target 2,500-3,000 words) — write full paragraphs (55-90
words) in intro/where/rights/example/conclusion and complete sentences in list items; do NOT pad with
repetition. Concrete over generic. Return JSON only.`;
}

/**
 * Call #2 prompt: copy for the CHOSEN interlinks. `links` = selectInterlinks() output; each entry
 * carries slug + title + niche so Gemini can write matching copy. `article` = normalized article.
 */
export function buildFunnelPrompt(article, links, lang) {
  const L = lang === "es" ? "es" : "en";
  const list = (items) => items.map((g) => `  - slug "${g.slug}": "${g.title}" [${g.niche || "guide"}]`).join("\n");
  const tagList = (links.tagSlugs || []).map((s) => `"${s}"`).join(", ");
  return `You write the navigation/funnel copy for a "job-style guide" page on "MKLern Pro"
(finance.magicoffers.shop), an independent educational publication. The article is already written;
you only write the short copy for the interlink blocks, the scroll box, the sticky bar and the CTA
labels. ${langLine(L)}

THE PAGE: "${article.title} ${article.titleAccent}" (category: ${article.category}).
Summary: ${article.guideSummary}
${COMPLIANCE_RULES}
${JOBGUIDE_TEMPLATE_RULES}

INTERLINKS (every "slug" you return MUST be one of the slugs listed for that block — never invent):
PILLS (7 entries, one per slug, in this order):
${list(links.pills || [])}
  → pillCopy: title = a big 2-5 word label for that guide; sub = a small 3-7 word benefit/topic pill
    (no invented numbers; a neutral range only if the title itself carries one).
PROMOS (3 entries, one per slug):
${list(links.promos || [])}
  → promoCopy: heading (3-7 words), text (15-30 words, what the reader learns there), button (2-4
    words, neutral: "Read the guide", "See careers" — never "Apply now").
CARDS (3 entries, one per slug):
${list(links.cards || [])}
  → cardCopy: title (the guide's headline, 6-14 words, may reuse the given title), excerpt (25-45 words).
TAGS: 10-12 {label, slug} tag-cloud entries; label = a 1-4 word topic label (unique labels, no
  duplicates), slug = the guide the tag links to, chosen ONLY from: ${tagList}. Include 3-4 labels
  about THIS page's own topic (point them at the closest related slug) and cover the other niches.

OTHER COPY:
- scrollBox: the "you're almost there" box shown mid-article. headline = 3 strings [before, accent,
  after] (e.g. ["You're ", "almost", " there!"]); pill1 = a one-line teaser (max 60 chars, one emoji
  ok); body = 3-9 runs {text, tone} that read as ONE sentence when concatenated (tone "none" for
  plain runs; highlight 2-3 key words with green/purple/yellow) telling the reader the details,
  requirements and steps are further down; pill2 = 2 strings [before, accent] ("Keep scrolling to see ",
  "the full details"). Never urgency/scarcity.
- stickyBar: text = one neutral line (max 70 chars) describing what the page holds; button = 1-2 words
  ("Start", "See steps") jumping to the steps section.
- cta1Label = neutral anchor label to the reference table (e.g. "See pay ranges & terms");
  cta2Label = to the eligibility section ("See who qualifies"); cta3Label = to the steps
  ("Start your application steps"). Never "Apply now", never pointing to an offer.
- relatedHeading / recentHeading / tagsHeading: short chrome headings ("Related guides", "Recent
  guides", "Tags" — translated for es).
Return JSON only.`;
}

// ---- interlink selection (contract §6) --------------------------------------------------------

const NICHE_ALIASES = { auto: "cars", autos: "cars", car: "cars", automotive: "cars" };

export function nicheKey(n) {
  const k = String(n || "").trim().toLowerCase();
  return NICHE_ALIASES[k] || k;
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function dedupeBySlug(list) {
  const seen = new Set();
  const out = [];
  for (const g of list) {
    if (!g || !g.slug || seen.has(g.slug)) continue;
    seen.add(g.slug);
    out.push(g);
  }
  return out;
}

/** n entries starting at `start`, wrapping around the pool (repeats only when the pool is short). */
function take(pool, start, n) {
  if (!pool.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

/**
 * Deterministic interlink selection.
 * catalog    = static guides (`GET /api/guides`.guides) — any lang, filtered here
 * recentAuto = published auto landings of the job's lang WITH an image, newest first
 * → { pool, pills(7), promos(3), cards(3), related(3), recent(5), tagSlugs(≤12) } — arrays of catalog
 *   entries ({slug,title,niche,image,width,height,lang}); tagSlugs = plain slugs.
 */
export function selectInterlinks(catalog, { lang, niche, selfSlug, recentAuto } = {}) {
  const L = lang === "es" ? "es" : "en";
  const nk = nicheKey(niche);
  const valid = (g) => g && g.slug && g.slug !== selfSlug && g.image && (g.lang || L) === L;
  const statics = (Array.isArray(catalog) ? catalog : []).filter(valid);
  const autos = dedupeBySlug((Array.isArray(recentAuto) ? recentAuto : []).filter(valid)).filter(
    (a) => !statics.some((s) => s.slug === a.slug),
  );
  const same = (g) => nk && nicheKey(g.niche) === nk;
  const pool = dedupeBySlug([
    ...statics.filter(same),
    ...autos.filter(same),
    ...autos.filter((g) => !same(g)),
    ...statics.filter((g) => !same(g)),
  ]);
  if (!pool.length) throw new Error(`interlink pool empty for lang=${L}`);
  const recentSeed = autos.slice(0, 5);
  const recent = dedupeBySlug([...recentSeed, ...pool]).slice(0, 5);
  return {
    pool,
    pills: take(pool, 0, 7),
    promos: take(pool, 0, 3),
    cards: take(pool, 3, 3),
    related: take(pool, 6, 3),
    recent,
    tagSlugs: uniq(take(pool, 0, 12).map((g) => g.slug)),
  };
}

// ---- fallback copy ----------------------------------------------------------------------------

const DASH_SPLIT = /\s+[—–]\s+/;

/** Deterministic copy derived from a catalog title: "Left — Right" → left = title, right = sub. */
export function fallbackCopyFor(guide) {
  const full = String(guide?.title || guide?.slug || "").trim();
  const [left, ...rest] = full.split(DASH_SPLIT);
  const right = rest.join(" – ").trim();
  const lang = guide?.lang === "es" ? "es" : "en";
  const button = lang === "es" ? "Leer la guía" : "Read the guide";
  return {
    title: (left || full).trim(),
    sub: right || String(guide?.niche || (lang === "es" ? "Guía" : "Guide")),
    heading: (left || full).trim(),
    text: right || full,
    button,
    excerpt: right ? `${left.trim()}: ${right}` : full,
    label: (left || full).trim().slice(0, 32),
  };
}

// ---- normalizers -----------------------------------------------------------------------------

const str = (v, max = 4000) => String(v ?? "").trim().slice(0, max);
const strArr = (v, maxItems, maxLen = 2000) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems);

export function kebab(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const DEFAULT_IDS = {
  en: { salary: "key-facts-table", eligibility: "who-qualifies", apply: "how-to-start" },
  es: { salary: "tabla-clave", eligibility: "quien-califica", apply: "como-empezar" },
};

const DEFAULT_CTA = {
  en: { cta1: "See rates & terms", cta2: "See who qualifies", cta3: "Start your application steps", sticky: "Start" },
  es: { cta1: "Ver tasas y condiciones", cta2: "Ver quién califica", cta3: "Empieza tus pasos de solicitud", sticky: "Empezar" },
};

const CHROME = {
  en: {
    related: "Related guides", recent: "Recent guides", tags: "Tags", disclaimer: "Disclaimer:",
    headline: ["You're ", "almost", " there!"], pill1: "Don't miss the details below",
    body: ["Keep reading to see the ", { text: "requirements", tone: "green" }, ", the ", { text: "ranges", tone: "purple" }, " and ", { text: "the steps", tone: "yellow" }, " — everything is further down the page."],
    pill2: ["Keep scrolling to see ", "the full details"],
    sticky: "Requirements, ranges and steps — all on this page",
    rewardsTitle: "Preparing the details for you", rewardsHint: "Watch a short ad to see the details, requirements and steps", tapLabel: "See the details",
  },
  es: {
    related: "Guías relacionadas", recent: "Guías recientes", tags: "Etiquetas", disclaimer: "Aviso:",
    headline: ["¡Ya casi ", "llegas", "!"], pill1: "No te pierdas los detalles más abajo",
    body: ["Sigue leyendo para ver los ", { text: "requisitos", tone: "green" }, ", los ", { text: "rangos", tone: "purple" }, " y ", { text: "los pasos", tone: "yellow" }, " — todo te espera más abajo."],
    pill2: ["Sigue bajando para ver ", "todos los detalles"],
    sticky: "Requisitos, rangos y pasos — todo en esta página",
    rewardsTitle: "Preparando los detalles para ti", rewardsHint: "Mira un anuncio breve para ver los detalles, requisitos y pasos", tapLabel: "Ver los detalles",
  },
};

function countWords(v) {
  if (typeof v === "string") return v.split(/\s+/).filter(Boolean).length;
  if (Array.isArray(v)) return v.reduce((n, x) => n + countWords(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n, x) => n + countWords(x), 0);
  return 0;
}

/** Word count of the article body (all text fields). */
export function articleWordCount(article) {
  return countWords(article);
}

/** Normalize + sanity-check Gemini's article JSON (call #1); throws when structurally unusable. */
export function normalizeArticle(a) {
  const sec = (s) => ({ heading: str(s?.heading, 200), intro: str(s?.intro, 1500) });
  const out = {
    title: str(a?.title, 200),
    titleAccent: str(a?.titleAccent, 160),
    category: str(a?.category, 40) || "Guide",
    description: str(a?.description, 320),
    rowTitle: str(a?.rowTitle, 70),
    quiz: {
      steps: (Array.isArray(a?.quiz?.steps) ? a.quiz.steps : [])
        .map((s) => ({ question: str(s?.question, 160), options: strArr(s?.options, 3, 60) }))
        .filter((s) => s.question && s.options.length >= 2) // template accepts 2-4 options; keep ≤3
        .slice(0, 3),
      rewardsTitle: str(a?.quiz?.rewardsTitle, 120),
      rewardsHint: str(a?.quiz?.rewardsHint, 200),
      tapLabel: str(a?.quiz?.tapLabel, 40),
    },
    intro: strArr(a?.intro, 3, 1200),
    guideSummary: str(a?.guideSummary, 1200),
    overview: {
      ...sec(a?.overview),
      rows: (Array.isArray(a?.overview?.rows) ? a.overview.rows : [])
        .map((r) => ({ label: str(r?.label, 80), value: str(r?.value, 240) }))
        .filter((r) => r.label && r.value)
        .slice(0, 8),
    },
    where: { heading: str(a?.where?.heading, 200), paras: strArr(a?.where?.paras, 3, 1500) },
    duties: { ...sec(a?.duties), items: strArr(a?.duties?.items, 7, 400), outro: str(a?.duties?.outro, 1000) },
    roles: {
      ...sec(a?.roles),
      items: (Array.isArray(a?.roles?.items) ? a.roles.items : [])
        .map((r) => ({ name: str(r?.name, 100), text: str(r?.text, 400) }))
        .filter((r) => r.name && r.text)
        .slice(0, 6),
    },
    eligibility: { id: kebab(a?.eligibility?.id), ...sec(a?.eligibility), items: strArr(a?.eligibility?.items, 6, 400) },
    documents: { ...sec(a?.documents), items: strArr(a?.documents?.items, 7, 400) },
    salary: {
      id: kebab(a?.salary?.id),
      ...sec(a?.salary),
      columns: strArr(a?.salary?.columns, 3, 80),
      rows: (Array.isArray(a?.salary?.rows) ? a.salary.rows : [])
        .map((r) => strArr(r?.cells, 3, 160))
        .filter((c) => c.length >= 2)
        .map((c) => ({ cells: [c[0], c[1], c[2] || "—"] }))
        .slice(0, 6),
      benefitsLead: str(a?.salary?.benefitsLead, 200),
      benefits: str(a?.salary?.benefits, 1500),
    },
    callout: { lead: str(a?.callout?.lead, 200), text: str(a?.callout?.text, 1500) },
    apply: { id: kebab(a?.apply?.id), heading: str(a?.apply?.heading, 200), steps: strArr(a?.apply?.steps, 7, 600) },
    find: { ...sec(a?.find), items: strArr(a?.find?.items, 5, 400) },
    growth: { ...sec(a?.growth), items: strArr(a?.growth?.items, 5, 400) },
    example: { heading: str(a?.example?.heading, 200), text: str(a?.example?.text, 2000) },
    mistakes: { heading: str(a?.mistakes?.heading, 200), items: strArr(a?.mistakes?.items, 6, 400) },
    rights: { heading: str(a?.rights?.heading, 200), paras: strArr(a?.rights?.paras, 2, 1800) },
    faq: {
      heading: str(a?.faq?.heading, 200),
      items: (Array.isArray(a?.faq?.items) ? a.faq.items : [])
        .map((f) => ({ q: str(f?.q, 250), a: str(f?.a, 900) }))
        .filter((f) => f.q && f.a)
        .slice(0, 7),
    },
    conclusion: { heading: str(a?.conclusion?.heading, 200), text: str(a?.conclusion?.text, 1500) },
    disclaimer: { lead: str(a?.disclaimer?.lead, 40), text: str(a?.disclaimer?.text, 1500) },
    imagePrompt: str(a?.imagePrompt, 700),
    imageAlt: str(a?.imageAlt, 250),
    imageCaption: str(a?.imageCaption, 250),
  };

  if (!out.title || !out.titleAccent) throw new Error("jobguide missing title parts");
  if (out.quiz.steps.length < 3) throw new Error(`jobguide quiz malformed: ${out.quiz.steps.length} steps`);
  if (out.intro.length < 2) throw new Error("jobguide missing intro");
  if (!out.guideSummary) throw new Error("jobguide missing guideSummary");
  if (out.overview.rows.length < 4) throw new Error(`jobguide overview too thin: ${out.overview.rows.length} rows`);
  if (out.where.paras.length < 1) throw new Error("jobguide missing where");
  if (out.duties.items.length < 3) throw new Error("jobguide duties too thin");
  if (out.roles.items.length < 3) throw new Error("jobguide roles too thin");
  if (out.eligibility.items.length < 3) throw new Error("jobguide eligibility too thin");
  if (out.documents.items.length < 3) throw new Error("jobguide documents too thin");
  if (out.salary.columns.length < 3) throw new Error("jobguide salary table missing columns");
  if (out.salary.rows.length < 3) throw new Error(`jobguide salary table too thin: ${out.salary.rows.length} rows`);
  if (!out.callout.text) throw new Error("jobguide missing callout");
  if (out.apply.steps.length < 4) throw new Error(`jobguide apply too thin: ${out.apply.steps.length} steps`);
  if (out.find.items.length < 2) throw new Error("jobguide find too thin");
  if (out.growth.items.length < 2) throw new Error("jobguide growth too thin");
  if (!out.example.text) throw new Error("jobguide missing example");
  if (out.mistakes.items.length < 3) throw new Error("jobguide mistakes too thin");
  if (out.rights.paras.length < 1) throw new Error("jobguide missing rights");
  if (out.faq.items.length < 4) throw new Error(`jobguide FAQ too thin: ${out.faq.items.length}`);
  if (!out.conclusion.text) throw new Error("jobguide missing conclusion");
  if (!out.disclaimer.text) throw new Error("jobguide missing disclaimer");
  const words = articleWordCount(out);
  if (words < 1200) throw new Error(`jobguide too thin: ${words} words`);
  return out;
}

const ALLOWED_TONES = new Set(["green", "purple", "yellow"]);

/** Like str() but KEEPS leading/trailing spaces — scroll-box runs concatenate into one sentence. */
const run = (v, max) => String(v ?? "").replace(/\s+/g, " ").slice(0, max);
const runArr = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : []).map((x) => run(x, maxLen)).filter((x) => x.trim()).slice(0, maxItems);

function normalizeRuns(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const r of v) {
    if (typeof r === "string") {
      if (r.trim()) out.push(run(r, 200));
      continue;
    }
    const text = run(r?.text, 200);
    if (!text.trim()) continue;
    const tone = String(r?.tone || "").toLowerCase();
    out.push(ALLOWED_TONES.has(tone) ? { text, tone } : text);
  }
  return out;
}

function fixedTuple(v, n, fallback) {
  const parts = runArr(v, 8, 120);
  if (!parts.length) return fallback.slice();
  if (parts.length === n) return parts;
  if (parts.length > n) return [...parts.slice(0, n - 1), parts.slice(n - 1).join(" ")];
  return [...parts, ...Array(n - parts.length).fill("")];
}

/**
 * Normalize Gemini's funnel JSON (call #2) against the chosen `links`: copy keyed by slug, only for
 * slugs that were offered; everything else is dropped (the assembler falls back per entry).
 */
export function normalizeFunnel(raw, links, lang) {
  const L = lang === "es" ? "es" : (links?.pills?.[0]?.lang === "es" ? "es" : "en");
  const C = CHROME[L];
  const byBlock = (list, key, fields) => {
    const allowed = new Set((links?.[key] || []).map((g) => g.slug));
    const map = {};
    for (const it of Array.isArray(list) ? list : []) {
      const slug = str(it?.slug, 120);
      if (!allowed.has(slug) || map[slug]) continue;
      const entry = {};
      for (const [f, max] of fields) entry[f] = str(it?.[f], max);
      if (Object.values(entry).every(Boolean)) map[slug] = entry;
    }
    return map;
  };
  const tagAllowed = new Set(links?.tagSlugs || []);
  const tags = [];
  const seenLabels = new Set();
  for (const t of Array.isArray(raw?.tags) ? raw.tags : []) {
    const label = str(t?.label, 32);
    const slug = str(t?.slug, 120);
    const key = label.toLowerCase();
    if (!label || !tagAllowed.has(slug) || seenLabels.has(key)) continue;
    seenLabels.add(key);
    tags.push({ label, slug });
  }
  return {
    normalized: true,
    pillCopy: byBlock(raw?.pillCopy, "pills", [["title", 60], ["sub", 60]]),
    promoCopy: byBlock(raw?.promoCopy, "promos", [["heading", 90], ["text", 300], ["button", 40]]),
    cardCopy: byBlock(raw?.cardCopy, "cards", [["title", 140], ["excerpt", 400]]),
    tags: tags.slice(0, 12),
    scrollBox: {
      headline: fixedTuple(raw?.scrollBox?.headline, 3, C.headline),
      pill1: str(raw?.scrollBox?.pill1, 80) || C.pill1,
      body: (() => {
        const runs = normalizeRuns(raw?.scrollBox?.body);
        return runs.length ? runs : C.body.slice();
      })(),
      pill2: fixedTuple(raw?.scrollBox?.pill2, 2, C.pill2),
    },
    stickyBar: {
      text: str(raw?.stickyBar?.text, 90) || C.sticky,
      button: str(raw?.stickyBar?.button, 24) || DEFAULT_CTA[L].sticky,
    },
    cta1Label: str(raw?.cta1Label, 60) || DEFAULT_CTA[L].cta1,
    cta2Label: str(raw?.cta2Label, 60) || DEFAULT_CTA[L].cta2,
    cta3Label: str(raw?.cta3Label, 60) || DEFAULT_CTA[L].cta3,
    relatedHeading: str(raw?.relatedHeading, 60) || C.related,
    recentHeading: str(raw?.recentHeading, 60) || C.recent,
    tagsHeading: str(raw?.tagsHeading, 40) || C.tags,
  };
}

// ---- assembly --------------------------------------------------------------------------------

const PROMO_COLORS = ["#2557a7", "#0a9d58", "#e8712a"];

function resolveIds(article, lang) {
  const d = DEFAULT_IDS[lang];
  const ids = {
    salary: article.salary.id || d.salary,
    eligibility: article.eligibility.id || d.eligibility,
    apply: article.apply.id || d.apply,
  };
  // Anchors must be distinct — a shared id breaks the in-page jumps.
  const used = new Set();
  for (const k of ["salary", "eligibility", "apply"]) {
    if (used.has(ids[k])) ids[k] = d[k];
    if (used.has(ids[k])) ids[k] = `${d[k]}-${k}`;
    used.add(ids[k]);
  }
  return ids;
}

function relatedEntry(g) {
  return {
    slug: g.slug,
    title: str(g.title, 160) || g.slug,
    image: g.image,
    width: Number(g.width) || 640,
    height: Number(g.height) || 360,
    meta: str(g.niche, 40) || (g.lang === "es" ? "Guía" : "Guide"),
  };
}

function ensureTuple(list, n) {
  const out = list.slice(0, n);
  if (!out.length) throw new Error("interlink tuple empty");
  while (out.length < n) out.push(out[out.length % list.length]);
  return out;
}

/**
 * Build the final JobGuideContent (contract §3). `links` = selectInterlinks() output; `funnel` =
 * normalizeFunnel() output (a raw funnel JSON is normalized here as well); `catalogBySlug` may
 * supply richer entries (image/width/height/niche) than the link entries themselves.
 * `figure` is { caption } only — the frontend merges hero media + hero_alt into it.
 */
export function assembleJobGuideContent({ slug, lang, article, funnel, links, catalogBySlug, figureCaption }) {
  const L = lang === "es" ? "es" : "en";
  const C = CHROME[L];
  const f = funnel && funnel.normalized ? funnel : normalizeFunnel(funnel, links, L);
  const entry = (g) => (catalogBySlug && catalogBySlug[g.slug]) || g;
  const ids = resolveIds(article, L);

  const pills = ensureTuple(links.pills.map(entry), 7).map((g) => {
    const fb = fallbackCopyFor(g);
    const c = f.pillCopy[g.slug] || {};
    return { slug: g.slug, title: c.title || fb.title, sub: c.sub || fb.sub };
  });
  const promos = ensureTuple(links.promos.map(entry), 3).map((g, i) => {
    const fb = fallbackCopyFor(g);
    const c = f.promoCopy[g.slug] || {};
    return {
      slug: g.slug,
      heading: c.heading || fb.heading,
      text: c.text || fb.text,
      button: c.button || fb.button,
      color: PROMO_COLORS[i % PROMO_COLORS.length],
    };
  });
  const cards = ensureTuple(links.cards.map(entry), 3).map((g) => {
    const fb = fallbackCopyFor(g);
    const c = f.cardCopy[g.slug] || {};
    return {
      slug: g.slug,
      title: c.title || fb.title,
      excerpt: c.excerpt || fb.excerpt,
      image: g.image,
      width: Number(g.width) || 640,
      height: Number(g.height) || 360,
    };
  });
  const related = ensureTuple(links.related.map(entry), 3).map(relatedEntry);
  const recent = links.recent.slice(0, 5).map(entry).map(relatedEntry);
  if (!recent.length) throw new Error("sidebar recent empty");

  // Tags: Gemini's (already validated) labels first, then fallback labels from the catalog titles.
  const tagSlugs = links.tagSlugs || [];
  const tags = [];
  const seen = new Set();
  const pushTag = (label, slugFor) => {
    const key = String(label).toLowerCase();
    if (!label || seen.has(key) || tags.length >= 12) return;
    seen.add(key);
    tags.push({ label, slug: slugFor });
  };
  for (const t of f.tags) pushTag(t.label, t.slug);
  for (const s of tagSlugs) {
    if (tags.length >= 10) break;
    pushTag(fallbackCopyFor(entry({ slug: s, ...(catalogBySlug?.[s] || {}) })).label, s);
  }
  for (const s of tagSlugs) {
    if (tags.length >= 10) break;
    const g = entry({ slug: s, ...(catalogBySlug?.[s] || {}) });
    pushTag(str(g.niche, 32), s);
  }
  const sized = tags.map((t, i) => ({ ...t, size: i < 2 ? 3 : i < 6 ? 2 : 1 }));

  const body = f.scrollBox.body.map((r) => (typeof r === "string" ? r : { text: r.text, tone: r.tone }));

  return {
    slug,
    lang: L,
    category: article.category,
    title: article.title,
    titleAccent: article.titleAccent,
    description: article.description,
    quiz: {
      steps: article.quiz.steps.slice(0, 3).map((s) => ({ question: s.question, options: s.options.slice(0, 3) })),
      rewardsTitle: article.quiz.rewardsTitle || C.rewardsTitle,
      rewardsHint: article.quiz.rewardsHint || C.rewardsHint,
      tapLabel: article.quiz.tapLabel || C.tapLabel,
      loaderMs: 1500,
    },
    pills,
    intro: article.intro,
    scrollBox: { headline: f.scrollBox.headline, pill1: f.scrollBox.pill1, body, pill2: f.scrollBox.pill2 },
    promos,
    guideSummary: article.guideSummary,
    cards,
    cta1: { label: f.cta1Label, target: ids.salary },
    overview: article.overview,
    figure: { caption: str(figureCaption ?? article.imageCaption, 250) },
    where: article.where,
    duties: article.duties,
    roles: article.roles,
    eligibility: { ...article.eligibility, id: ids.eligibility },
    documents: article.documents,
    salary: {
      ...article.salary,
      id: ids.salary,
      columns: [article.salary.columns[0], article.salary.columns[1], article.salary.columns[2]],
    },
    cta2: { label: f.cta2Label, target: ids.eligibility },
    callout: article.callout,
    apply: { ...article.apply, id: ids.apply },
    find: article.find,
    growth: article.growth,
    example: article.example,
    mistakes: article.mistakes,
    rights: article.rights,
    faq: article.faq,
    conclusion: article.conclusion,
    cta3: { label: f.cta3Label, target: ids.apply },
    disclaimer: { lead: article.disclaimer.lead || C.disclaimer, text: article.disclaimer.text },
    related: { heading: f.relatedHeading, items: related },
    stickyBar: { text: f.stickyBar.text, button: f.stickyBar.button, target: ids.apply },
    sidebar: { recentHeading: f.recentHeading, recent, tagsHeading: f.tagsHeading, tags: sized },
  };
}

/** Quick structural checklist used by the dry-run + tests. Returns a list of problems (empty = ok). */
export function checkJobGuideContent(c, allowedSlugs) {
  const problems = [];
  const allowed = new Set(allowedSlugs || []);
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  need(c.pills?.length === 7, `pills=${c.pills?.length}`);
  need(c.promos?.length === 3, `promos=${c.promos?.length}`);
  need(c.cards?.length === 3, `cards=${c.cards?.length}`);
  need(c.related?.items?.length === 3, `related=${c.related?.items?.length}`);
  need(c.sidebar?.recent?.length >= 1 && c.sidebar.recent.length <= 5, `recent=${c.sidebar?.recent?.length}`);
  need(c.sidebar?.tags?.length >= 10 && c.sidebar.tags.length <= 12, `tags=${c.sidebar?.tags?.length}`);
  need(c.quiz?.steps?.length === 3 && c.quiz.steps.every((s) => s.options.length >= 2 && s.options.length <= 3), "quiz not 3x(2-3)");
  need(c.quiz?.loaderMs === 1500, "loaderMs");
  const slugs = [
    ...c.pills.map((p) => p.slug), ...c.promos.map((p) => p.slug), ...c.cards.map((p) => p.slug),
    ...c.related.items.map((p) => p.slug), ...c.sidebar.recent.map((p) => p.slug), ...c.sidebar.tags.map((p) => p.slug),
  ];
  if (allowed.size) for (const s of slugs) need(allowed.has(s), `slug not in pool: ${s}`);
  need(!slugs.includes(c.slug), "self-link");
  const ids = [c.eligibility.id, c.salary.id, c.apply.id];
  need(ids.every((i) => /^[a-z0-9-]+$/.test(i)), `ids not kebab: ${ids.join(",")}`);
  need(new Set(ids).size === 3, `ids not distinct: ${ids.join(",")}`);
  need(c.cta1.target === c.salary.id && c.cta2.target === c.eligibility.id && c.cta3.target === c.apply.id && c.stickyBar.target === c.apply.id, "cta targets");
  need(c.salary.columns.length === 3 && c.salary.rows.every((r) => r.cells.length === 3), "salary table shape");
  need(c.scrollBox.headline.length === 3 && c.scrollBox.pill2.length === 2, "scrollBox tuples");
  need(Object.keys(c.figure || {}).join(",") === "caption", "figure must be {caption} only");
  const labels = c.sidebar.tags.map((t) => t.label.toLowerCase());
  need(new Set(labels).size === labels.length, "duplicate tag labels");
  return problems;
}
