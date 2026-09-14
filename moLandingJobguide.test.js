import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectInterlinks,
  normalizeArticle,
  normalizeFunnel,
  assembleJobGuideContent,
  fallbackCopyFor,
  funnelSchemaFor,
  checkJobGuideContent,
  buildArticlePrompt,
  buildFunnelPrompt,
  COMPLIANCE_RULES,
  nicheKey,
} from "./moLandingJobguide.js";

// ---- fixtures ------------------------------------------------------------------------------

const g = (slug, niche, title, lang = "en", extra = {}) => ({
  slug, lang, niche, title, image: `/img/thumbs/${slug}.jpg`, width: 640, height: 360, ...extra,
});

const EN = [
  g("digital-marketing-jobs-2026", "MK Digital", "Digital Marketing Jobs 2026 — Openings, Salary & How to Apply"),
  g("seo-fundamentals-course", "MK Digital", "SEO Fundamentals Course — The Skill Behind Free Traffic"),
  g("high-paying-jobs-short-training", "Jobs", "Careers That Can Reach $70k — After Weeks of Training"),
  g("jobs-30-an-hour-no-degree", "Jobs", "Jobs Paying $30+/Hour — No College Degree Required"),
  g("fastest-growing-job-in-america", "Jobs", "America's Fastest-Growing Job — Easier to Enter Than You Think"),
  g("auto-loans-2026", "Cars", "Auto Loans 2026 — Rates, Eligibility & How to Apply"),
  g("auto-financing-explained", "Cars", "Auto Financing Explained — What the Dealer Won't Tell You"),
  g("personal-loans", "Loans", "Personal Loans — What to Know Before You Borrow"),
  g("retiree-health-coverage", "Health", "Retirees — The Coverage Gap Most People Miss"),
  g("never-do-this-on-a-plane", "Travel", "Never Do This on a Plane — Crew Reveal Why"),
  g("pick-a-tarot-card", "Self-Discovery", "Pick a Tarot Card — Then Read What It May Mean"),
];
const ES = [
  g("empleos-30-por-hora-sin-titulo", "Jobs", "Empleos de $30+ por hora — sin título universitario", "es"),
  g("prestamos-de-auto-2026", "Cars", "Préstamos de auto 2026 — tasas, requisitos y cómo solicitar", "es"),
  g("financiamiento-de-auto", "Cars", "Financiamiento de auto — lo que el concesionario no dice", "es"),
];
const CATALOG = [...EN, ...ES];

const AUTO = [
  { slug: "auto-2", lang: "en", niche: "Cars", title: "Used Car Loans – What Changes in 2026", image: "https://cdn.example.com/small_a2.jpg", width: 500, height: 279, auto: true },
  { slug: "auto-1", lang: "en", niche: "Travel", title: "Cheap Flights – Timing Tricks", image: "https://cdn.example.com/small_a1.jpg", width: 500, height: 279, auto: true },
];

const P = (n, w = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor") =>
  Array.from({ length: n }, (_, i) => `${w} ${i + 1}. ${w}.`);

function fullArticle(over = {}) {
  return {
    title: "Warehouse jobs in 2026",
    titleAccent: "– Openings, pay & how to apply",
    category: "Jobs & careers",
    description: "A complete 2026 guide to warehouse jobs: openings, indicative pay, requirements, documents and steps.",
    rowTitle: "Warehouse Jobs 2026 — Openings, Pay & How to Apply",
    quiz: {
      steps: [
        { question: "What are you looking for?", options: ["Full-time", "Part-time", "Seasonal"] },
        { question: "When would you start?", options: ["This month", "In 1-3 months", "Just exploring"] },
        { question: "Which shift?", options: ["Day", "Night", "Any"] },
      ],
      rewardsTitle: "Preparing the openings for you",
      rewardsHint: "Watch a short ad to see the details",
      tapLabel: "See the details",
    },
    intro: P(3, "Warehouse work remains one of the most common entry points into steady employment across the United States, with distribution centers and fulfilment hubs hiring throughout the year and many roles asking for no prior experience"),
    guideSummary: "This complete guide explains everything readers need to know about warehouse jobs in 2026: where the openings are, what the work involves, who qualifies, the documents typically needed, indicative pay ranges and a clear step-by-step to apply. Figures are indicative national ranges that vary by employer, location and experience.",
    overview: { heading: "Warehouse jobs at a glance", intro: "A quick summary of what the role typically looks like.", rows: Array.from({ length: 7 }, (_, i) => ({ label: `Row ${i}`, value: `Indicative value ${i} that varies by location and employer` })) },
    where: { heading: "Where the openings are", paras: P(3, "Distribution centers cluster near highways, ports and large metro areas, and many operators run several shifts a day, which is why openings appear throughout the year rather than only in one season") },
    duties: { heading: "What the work involves", intro: "Typical day-to-day tasks:", items: P(6), outro: "Calm, steady and safety-first is what employers usually reward." },
    roles: { heading: "Main types of warehouse roles", intro: "Common positions include:", items: Array.from({ length: 5 }, (_, i) => ({ name: `Role ${i}`, text: `what this role does day to day, in a sentence ${i}` })) },
    eligibility: { id: "Who Qualifies?", heading: "Who qualifies", intro: "Most employers ask for:", items: P(5) },
    documents: { heading: "Documents usually needed", intro: "Have these ready:", items: P(6) },
    salary: {
      id: "pay ranges",
      heading: "Indicative pay ranges",
      intro: "These are indicative national ranges, not offers.",
      columns: ["Role", "Typical hourly range", "Notes"],
      rows: [
        { cells: ["Picker", "~$15–19", "Entry"] }, { cells: ["Forklift", "~$17–23", "Certification"] },
        { cells: ["Lead", "~$19–26", "Experience"] }, { cells: ["Supervisor", "~$22–30"] },
      ],
      benefitsLead: "What a good offer usually includes:",
      benefits: "predictable schedules, overtime rules in writing and safety training. Ranges vary by location, employer and experience.",
    },
    callout: { lead: "★ Never pay upfront to get a job.", text: "Legitimate employers never ask for money, gift cards or transfers before hiring." },
    apply: { id: "How to Apply", heading: "Step by step: how to apply", steps: P(6) },
    find: { heading: "Where to look", intro: "Legitimate channels:", items: P(4) },
    growth: { heading: "How the role can grow", intro: "Over time:", items: P(4) },
    example: { heading: "Worked example", text: "Imagine a reader who starts as a picker on a day shift and completes forklift training within a year; the range may move accordingly, though outcomes vary." },
    mistakes: { heading: "Common mistakes", items: P(5) },
    rights: { heading: "Your rights and scam patterns", paras: P(2, "Workers have rights around pay, breaks and safety, and the most common scam pattern is a request for an upfront fee or personal documents before any interview has taken place") },
    faq: { heading: "FAQ", items: Array.from({ length: 6 }, (_, i) => ({ q: `Question ${i}?`, a: `An honest, hedged answer number ${i} that explains what many people find in practice, without promises.` })) },
    conclusion: { heading: "Conclusion", text: "Warehouse work can be a steady entry point for many readers; compare openings calmly and never pay upfront." },
    disclaimer: { lead: "Disclaimer:", text: "This guide is independent editorial content for information only and is not employment, legal or financial advice. Pay figures are indicative and vary." },
    imagePrompt: "Editorial photograph of a bright, orderly distribution warehouse aisle with tall racks, pallets and a parked forklift, morning light through high windows, no people.",
    imageAlt: "Orderly warehouse aisle with tall racks and a parked forklift in morning light",
    imageCaption: "Distribution centers hire year-round; most entry roles need no prior experience.",
    ...over,
  };
}

const SCHEMA_IDS = ["pay-ranges", "who-qualifies", "how-to-apply"];

// ---- selectInterlinks ----------------------------------------------------------------------

test("selectInterlinks: same-niche static first, then autos, then the rest in ring order; never self", () => {
  const r = selectInterlinks(CATALOG, { lang: "en", niche: "Auto", selfSlug: "auto-loans-2026", recentAuto: AUTO });
  assert.equal(r.pool[0].slug, "auto-financing-explained", "static same-niche (Auto→Cars) first");
  assert.equal(r.pool[1].slug, "auto-2", "same-niche auto landing next");
  assert.equal(r.pool[2].slug, "auto-1", "other auto landings after the same-niche block");
  assert.equal(r.pool[3].slug, "digital-marketing-jobs-2026", "then the static ring in order");
  assert.ok(!r.pool.some((x) => x.slug === "auto-loans-2026"), "self excluded");
  assert.ok(r.pool.every((x) => x.lang === "en"), "only the job's lang");
  assert.equal(r.pills.length, 7);
  assert.deepEqual(r.promos.map((x) => x.slug), r.pool.slice(0, 3).map((x) => x.slug));
  assert.deepEqual(r.cards.map((x) => x.slug), r.pool.slice(3, 6).map((x) => x.slug));
  assert.deepEqual(r.related.map((x) => x.slug), r.pool.slice(6, 9).map((x) => x.slug));
  assert.equal(r.tagSlugs.length, 12);
  assert.equal(new Set(r.tagSlugs).size, 12);
});

test("selectInterlinks: recent auto landings lead the sidebar, filled up from the pool to 5", () => {
  const r = selectInterlinks(CATALOG, { lang: "en", niche: "Jobs", selfSlug: "x", recentAuto: AUTO });
  assert.deepEqual(r.recent.slice(0, 2).map((x) => x.slug), ["auto-2", "auto-1"]);
  assert.equal(r.recent.length, 5);
  assert.equal(new Set(r.recent.map((x) => x.slug)).size, 5);
  assert.equal(r.recent[2].slug, "high-paying-jobs-short-training", "filled from the (niche-first) pool");
});

test("selectInterlinks: wraps when the pool is short and dedupes duplicates", () => {
  const r = selectInterlinks([...ES, ...ES], { lang: "es", niche: "Cars", selfSlug: "prestamos-de-auto-2026", recentAuto: [] });
  assert.equal(r.pool.length, 2, "deduped");
  assert.equal(r.pills.length, 7, "pills wrap to 7");
  // cards = pool items 4-6 → indexes 3,4,5 wrapped over a 2-item pool = [1, 0, 1]
  assert.deepEqual(r.cards.map((x) => x.slug), ["empleos-30-por-hora-sin-titulo", "financiamiento-de-auto", "empleos-30-por-hora-sin-titulo"]);
  assert.equal(r.recent.length, 2);
  assert.throws(() => selectInterlinks([], { lang: "en", niche: "Jobs", selfSlug: "a", recentAuto: [] }), /pool empty/);
});

test("nicheKey: Auto counts as Cars, case-insensitive", () => {
  assert.equal(nicheKey("Auto"), "cars");
  assert.equal(nicheKey("CARS"), "cars");
  assert.equal(nicheKey("Side Gigs"), "side gigs");
});

// ---- normalizeArticle ----------------------------------------------------------------------

test("normalizeArticle: accepts a full article, kebabs the ids, pads a 2-cell row", () => {
  const a = normalizeArticle(fullArticle());
  assert.equal(a.eligibility.id, "who-qualifies");
  assert.equal(a.salary.id, "pay-ranges");
  assert.equal(a.apply.id, "how-to-apply");
  assert.equal(a.salary.rows.length, 4);
  assert.deepEqual(a.salary.rows[3].cells, ["Supervisor", "~$22–30", "—"]);
  assert.equal(a.quiz.steps.length, 3);
});

test("normalizeArticle: rejects thin input", () => {
  assert.throws(() => normalizeArticle({}), /missing title/);
  assert.throws(() => normalizeArticle(fullArticle({ quiz: { steps: [{ question: "q", options: ["a", "b"] }] } })), /quiz malformed/);
  assert.throws(() => normalizeArticle(fullArticle({ overview: { heading: "h", intro: "i", rows: [{ label: "a", value: "b" }] } })), /overview too thin/);
  assert.throws(() => normalizeArticle(fullArticle({ salary: { ...fullArticle().salary, columns: ["a", "b"] } })), /missing columns/);
  assert.throws(() => normalizeArticle(fullArticle({ apply: { id: "x", heading: "h", steps: ["1", "2"] } })), /apply too thin/);
  assert.throws(() => normalizeArticle(fullArticle({ faq: { heading: "h", items: [{ q: "a", a: "b" }] } })), /FAQ too thin/);
  assert.throws(() => normalizeArticle(fullArticle({ disclaimer: { lead: "x", text: "" } })), /missing disclaimer/);
  // Structurally complete but far too short overall → word-count guard.
  const short = fullArticle();
  const one = (n) => Array.from({ length: n }, (_, i) => `w${i}`);
  short.intro = one(3); short.where.paras = one(2); short.duties.items = one(5); short.eligibility.items = one(5);
  short.documents.items = one(5); short.apply.steps = one(5); short.find.items = one(4); short.growth.items = one(4);
  short.mistakes.items = one(5); short.rights.paras = one(2); short.example.text = "x"; short.conclusion.text = "x";
  short.guideSummary = "x"; short.duties.outro = "x"; short.salary.benefits = "x";
  short.faq.items = short.faq.items.map((f) => ({ q: "q?", a: "a" }));
  short.overview.rows = short.overview.rows.map((r) => ({ label: "l", value: "v" }));
  short.roles.items = short.roles.items.map((r) => ({ name: "n", text: "t" }));
  assert.throws(() => normalizeArticle(short), /too thin: \d+ words/);
});

// ---- assemble ------------------------------------------------------------------------------

function assembleWith(funnelRaw, opts = {}) {
  const lang = opts.lang || "en";
  const catalog = opts.catalog || CATALOG;
  const recentAuto = opts.recentAuto || AUTO;
  const article = normalizeArticle(opts.article || fullArticle());
  const links = selectInterlinks(catalog, { lang, niche: opts.niche || "Jobs", selfSlug: "warehouse-jobs-2026", recentAuto });
  const catalogBySlug = {};
  for (const x of links.pool) catalogBySlug[x.slug] = x;
  const funnel = normalizeFunnel(funnelRaw, links, lang);
  const content = assembleJobGuideContent({ slug: "warehouse-jobs-2026", lang, article, funnel, links, catalogBySlug, figureCaption: article.imageCaption });
  return { content, links, article };
}

test("assemble: exactly-3 tuples, 7 pills, 5 recent, 10-12 tags, valid ids + cta targets, figure = {caption}", () => {
  const { content: c, links } = assembleWith({});
  const problems = checkJobGuideContent(c, links.pool.map((x) => x.slug));
  assert.deepEqual(problems, []);
  assert.equal(c.pills.length, 7);
  assert.equal(c.promos.length, 3);
  assert.equal(c.cards.length, 3);
  assert.equal(c.related.items.length, 3);
  assert.equal(c.sidebar.recent.length, 5);
  assert.ok(c.sidebar.tags.length >= 10 && c.sidebar.tags.length <= 12);
  assert.deepEqual([c.salary.id, c.eligibility.id, c.apply.id], SCHEMA_IDS);
  assert.equal(c.cta1.target, c.salary.id);
  assert.equal(c.cta2.target, c.eligibility.id);
  assert.equal(c.cta3.target, c.apply.id);
  assert.equal(c.stickyBar.target, c.apply.id);
  assert.deepEqual(c.figure, { caption: fullArticle().imageCaption });
  assert.equal(c.quiz.loaderMs, 1500);
  assert.equal(c.slug, "warehouse-jobs-2026");
  assert.equal(c.lang, "en");
  assert.deepEqual(c.promos.map((p) => p.color), ["#2557a7", "#0a9d58", "#e8712a"]);
  assert.deepEqual(c.sidebar.tags.slice(0, 2).map((t) => t.size), [3, 3]);
  // Fallback chrome copy when the funnel call returned nothing.
  assert.equal(c.cta1.label, "See rates & terms");
  assert.equal(c.related.heading, "Related guides");
  assert.equal(c.scrollBox.headline.length, 3);
  assert.equal(c.scrollBox.pill2.length, 2);
});

test("assemble: junk/foreign slugs from Gemini → deterministic fallback copy from the catalog title", () => {
  const { content: c, links } = assembleWith({
    pillCopy: [
      { slug: "made-up-slug", title: "Junk", sub: "Junk" },
      { slug: links_first(), title: "Custom pill title", sub: "Custom sub" },
    ],
    promoCopy: [{ slug: "another-junk", heading: "x", text: "y", button: "z" }],
    cardCopy: [{ slug: "prestamos-de-auto-2026", title: "wrong lang slug", excerpt: "nope" }],
    tags: [
      { label: "Junk tag", slug: "nope" },
      { label: "Warehouse jobs", slug: "high-paying-jobs-short-training" },
      { label: "warehouse JOBS", slug: "jobs-30-an-hour-no-degree" }, // duplicate label (case-insensitive) dropped
    ],
    cta1Label: "See pay ranges",
  });
  assert.equal(c.pills[0].title, "Custom pill title");
  assert.equal(c.pills[0].sub, "Custom sub");
  // 2nd pill = jobs-30-an-hour-no-degree → fallback from "Jobs Paying $30+/Hour — No College Degree Required"
  assert.equal(c.pills[1].slug, "jobs-30-an-hour-no-degree");
  assert.equal(c.pills[1].title, "Jobs Paying $30+/Hour");
  assert.equal(c.pills[1].sub, "No College Degree Required");
  assert.equal(c.promos[0].heading, "Careers That Can Reach $70k");
  assert.equal(c.promos[0].text, "After Weeks of Training");
  assert.equal(c.promos[0].button, "Read the guide");
  assert.ok(c.cards.every((x) => x.slug !== "prestamos-de-auto-2026"), "ES slug never leaks into an EN page");
  assert.equal(c.sidebar.tags[0].label, "Warehouse jobs");
  assert.ok(!c.sidebar.tags.some((t) => t.label === "Junk tag"));
  assert.equal(new Set(c.sidebar.tags.map((t) => t.label.toLowerCase())).size, c.sidebar.tags.length);
  assert.ok(c.sidebar.tags.length >= 10);
  assert.equal(c.cta1.label, "See pay ranges");
  assert.deepEqual(checkJobGuideContent(c, links.pool.map((x) => x.slug)), []);

  function links_first() {
    return "high-paying-jobs-short-training";
  }
});

test("assemble: remote (auto landing) + static images keep their real sizes; recent autos first; meta = niche", () => {
  const { content: c } = assembleWith({}, { niche: "Cars" });
  const auto = c.sidebar.recent[0];
  assert.equal(auto.slug, "auto-2");
  assert.equal(auto.image, "https://cdn.example.com/small_a2.jpg");
  assert.equal(auto.width, 500);
  assert.equal(auto.height, 279);
  assert.equal(auto.meta, "Cars");
  const stat = c.sidebar.recent[2];
  assert.match(stat.image, /^\/img\/thumbs\//);
  assert.equal(stat.width, 640);
  assert.equal(stat.height, 360);
  // Cars niche → pills open with the static Cars guides, then the Cars auto landing.
  assert.deepEqual(c.pills.slice(0, 3).map((p) => p.slug), ["auto-loans-2026", "auto-financing-explained", "auto-2"]);
  const card = c.cards.find((x) => x.slug === "auto-1");
  if (card) assert.equal(card.width, 500);
});

test("assemble: ES defaults when Gemini ids are junk or collide", () => {
  const article = fullArticle({ eligibility: { ...fullArticle().eligibility, id: "" }, salary: { ...fullArticle().salary, id: "???" }, apply: { ...fullArticle().apply, id: "" } });
  const { content: c } = assembleWith({}, { lang: "es", catalog: ES, recentAuto: [], article, niche: "Cars" });
  assert.deepEqual([c.salary.id, c.eligibility.id, c.apply.id], ["tabla-clave", "quien-califica", "como-empezar"]);
  assert.equal(c.cta3.label, "Empieza tus pasos de solicitud");
  assert.equal(c.sidebar.tagsHeading, "Etiquetas");
  assert.equal(c.promos[0].button, "Leer la guía");
  const dup = fullArticle({ eligibility: { ...fullArticle().eligibility, id: "same" }, salary: { ...fullArticle().salary, id: "same" }, apply: { ...fullArticle().apply, id: "same" } });
  const { content: d } = assembleWith({}, { article: dup });
  assert.equal(new Set([d.salary.id, d.eligibility.id, d.apply.id]).size, 3);
});

test("normalizeFunnel: scrollBox runs keep tones, plain runs become strings, bad tuples are repaired", () => {
  const { content: c } = assembleWith({
    scrollBox: {
      headline: ["Only one"],
      pill1: "Teaser",
      body: [{ text: "Scroll for ", tone: "none" }, { text: "pay", tone: "green" }, { text: " and ", tone: "bogus" }, { text: "steps", tone: "yellow" }],
      pill2: ["a", "b", "c"],
    },
    stickyBar: { text: "Everything on this page", button: "Start" },
  });
  assert.deepEqual(c.scrollBox.headline, ["Only one", "", ""]);
  assert.deepEqual(c.scrollBox.body, ["Scroll for ", { text: "pay", tone: "green" }, " and ", { text: "steps", tone: "yellow" }]);
  assert.deepEqual(c.scrollBox.pill2, ["a", "b c"]);
  assert.equal(c.stickyBar.button, "Start");
});

// ---- misc ----------------------------------------------------------------------------------

test("fallbackCopyFor splits on em/en dashes", () => {
  const f = fallbackCopyFor({ slug: "x", title: "Left part – right part", lang: "en", niche: "Jobs" });
  assert.equal(f.title, "Left part");
  assert.equal(f.sub, "right part");
  const g2 = fallbackCopyFor({ slug: "y", title: "No dash here", lang: "es", niche: "Salud" });
  assert.equal(g2.title, "No dash here");
  assert.equal(g2.sub, "Salud");
  assert.equal(g2.button, "Leer la guía");
});

test("funnelSchemaFor constrains every slug with an enum of the offered slugs", () => {
  const links = selectInterlinks(CATALOG, { lang: "en", niche: "Jobs", selfSlug: "x", recentAuto: AUTO });
  const schema = funnelSchemaFor(links);
  for (const k of ["pillCopy", "promoCopy", "cardCopy", "tags"]) {
    const en = schema.properties[k].items.properties.slug.enum;
    assert.ok(Array.isArray(en) && en.length >= 12, `${k} enum`);
    assert.ok(!en.includes("x"));
  }
  assert.equal(schema.properties.scrollBox.properties.body.items.properties.tone.enum.length, 4);
});

test("prompts embed the full compliance envelope + language rule + notes as angle only", () => {
  const p = buildArticlePrompt({ title: "Préstamos personales en 2026", lang: "es", niche: "Loans", notes: "focus on first-time borrowers" });
  assert.ok(p.includes(COMPLIANCE_RULES.trim()));
  assert.ok(p.includes("Latin-American Spanish"));
  assert.ok(p.includes("USD"));
  assert.ok(p.includes("ANGLE only"));
  assert.ok(p.includes("focus on first-time borrowers"));
  assert.ok(p.includes("Never pay"));
  assert.ok(p.includes("at least 2,300 words"));
  const links = selectInterlinks(CATALOG, { lang: "en", niche: "Jobs", selfSlug: "x", recentAuto: AUTO });
  const article = normalizeArticle(fullArticle());
  const fp = buildFunnelPrompt(article, links, "en");
  assert.ok(fp.includes(COMPLIANCE_RULES.trim()));
  for (const pill of links.pills) assert.ok(fp.includes(`"${pill.slug}"`));
});
