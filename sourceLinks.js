/**
 * Source links for generated articles (pixelhost / wpcrew / uxdictionary).
 *
 * Gemini proposes authoritative references for an article topic; every URL is
 * then HTTP-validated (must resolve to a final 2xx, and a deep path must not
 * soft-404 to the site root). Survivors (target 3-5, max 2 per host) are
 * returned as {url, title, publisher, anchorPhrase} and can be rendered as a
 * "Sources & Further Reading" blocks section + woven inline into paragraphs.
 *
 * Env: GEMINI_API_KEY (same key the article generators use).
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.SOURCES_GEMINI_MODEL || "gemini-2.5-flash";

export const SOURCES_HEADING = "Sources & Further Reading";

const log = (...a) => console.log("[sources]", ...a);

const SOURCES_SCHEMA = {
  type: "object",
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          publisher: { type: "string" },
          anchorPhrase: { type: "string" },
        },
        required: ["url", "title", "publisher", "anchorPhrase"],
      },
    },
  },
  required: ["sources"],
};

async function gemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SOURCES_SCHEMA, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`gemini sources ${res.status}: ${JSON.stringify(body?.error || "")?.slice(0, 200)}`);
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("empty gemini sources response");
  return JSON.parse(text);
}

function proposalPrompt({ title, summary, siteContext, avoid }) {
  return (
    `You are compiling the reference list for an article titled "${title}".` +
    (summary ? ` Article summary: ${summary}.` : "") +
    ` The article is published on ${siteContext}.\n` +
    `Return 8 REAL, currently-live, authoritative web pages that support or expand this article's subject matter.\n` +
    `STRICT rules:\n` +
    `- Only well-established authoritative publishers: Wikipedia, MDN Web Docs, W3C / WAI, web.dev, Google Search Central, Nielsen Norman Group, Interaction Design Foundation, Smashing Magazine, CSS-Tricks, A List Apart, WordPress.org documentation, ICANN, IETF (RFCs), OWASP, Cloudflare Learning Center, official product documentation.\n` +
    `- Prefer evergreen DEEP pages that have existed for years (a specific Wikipedia article, a specific MDN reference page) — never homepages, never news posts, never search results.\n` +
    `- HTTPS only. No URL shorteners, no affiliate or commercial landing pages, no PDFs behind forms.\n` +
    `- DO NOT fabricate URLs. If you are not confident the exact path exists, use the relevant Wikipedia article instead (its exact canonical URL).\n` +
    `- At most 2 pages from the same website; aim for at least 4 different publishers.\n` +
    (avoid?.length ? `- Do NOT repeat any of these URLs (they were already tried and failed): ${avoid.join(", ")}\n` : "") +
    `For each source return: url; title (the page's real title WITHOUT any trailing " - Publisher" or "| Site" suffix, plain text); publisher (short name, e.g. "Wikipedia", "MDN Web Docs"); anchorPhrase (a short 1-3 word term that very likely appears verbatim in an article about this topic, e.g. "DNS records", "cognitive load", "shared hosting").`
  );
}

/** true if url survives: final 2xx after redirects, deep link didn't collapse to site root. */
export async function validateSourceUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (!u.hostname.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return false;
  try {
    const res = await fetch(u.href, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return false;
    // Soft-404 guard: a deep path that redirected to the bare site root is a dead page.
    const finalU = new URL(res.url || u.href);
    if (u.pathname.replace(/\/+$/, "").length > 1 && finalU.pathname.replace(/\/+$/, "").length <= 1) return false;
    return true;
  } catch {
    return false;
  }
}

/** Strip trailing " - Publisher" / "| Site" tails that duplicate the publisher/host. */
function cleanTitle(title, publisher, hostname) {
  let t = title;
  const pub = (publisher || "").toLowerCase();
  const hostWord = (hostname || "").replace(/^www\./, "").split(".")[0].toLowerCase();
  for (let i = 0; i < 3; i++) {
    const m = t.match(/^(.+?)\s*[|\-–—]\s*([^|\-–—]+)$/);
    if (!m) break;
    const tail = m[2].trim().toLowerCase();
    const related =
      (pub && (tail.includes(pub.split(" ")[0]) || pub.includes(tail))) ||
      (hostWord.length > 2 && tail.includes(hostWord));
    if (!related || !m[1].trim()) break;
    t = m[1].trim();
  }
  return t;
}

function normalizeCandidates(raw) {
  const seen = new Set();
  const out = [];
  for (const s of raw?.sources || []) {
    const url = (s?.url || "").trim();
    const title = (s?.title || "").trim();
    if (!url || !title) continue;
    let key, host;
    try {
      const u = new URL(url);
      host = u.hostname;
      key = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const publisher = (s.publisher || "").trim().slice(0, 60);
    out.push({
      url,
      title: cleanTitle(title, publisher, host).slice(0, 160),
      publisher,
      anchorPhrase: (s.anchorPhrase || "").trim().slice(0, 60),
    });
  }
  return out;
}

/**
 * Propose + validate sources for an article. Returns 0..max validated sources
 * (never throws on validation shortfall — the article must still publish).
 */
export async function buildValidatedSources({ title, summary = "", siteContext, min = 3, max = 5 }) {
  if (!GEMINI_KEY) throw new Error("missing GEMINI_API_KEY for sources");
  const picked = [];
  const perHost = new Map();
  const tried = [];

  for (let round = 0; round < 2 && picked.length < min; round++) {
    let candidates;
    try {
      candidates = normalizeCandidates(
        await gemini(proposalPrompt({ title, summary, siteContext, avoid: round ? tried : [] })),
      );
    } catch (e) {
      log(`proposal round ${round + 1} failed: ${e.message}`);
      continue;
    }
    const fresh = candidates.filter((c) => !tried.includes(c.url));
    tried.push(...fresh.map((c) => c.url));
    const checks = await Promise.allSettled(fresh.map((c) => validateSourceUrl(c.url)));
    for (let i = 0; i < fresh.length && picked.length < max; i++) {
      if (checks[i].status !== "fulfilled" || !checks[i].value) continue;
      const host = new URL(fresh[i].url).hostname.replace(/^www\./, "");
      const n = perHost.get(host) || 0;
      if (n >= 2) continue;
      perHost.set(host, n + 1);
      picked.push(fresh[i]);
    }
    log(`round ${round + 1}: ${fresh.length} candidates -> ${picked.length} valid`);
  }

  if (picked.length < min) log(`WARN: only ${picked.length} validated sources for "${title}"`);
  return picked;
}

/** "Sources & Further Reading" h2 + linked list, in Strapi blocks format. */
export function sourcesToBlocks(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return [];
  return [
    { type: "heading", level: 2, children: [{ type: "text", text: SOURCES_HEADING }] },
    {
      type: "list",
      format: "unordered",
      children: sources.map((s) => ({
        type: "list-item",
        children: [
          { type: "link", url: s.url, children: [{ type: "text", text: s.title }] },
          { type: "text", text: s.publisher ? ` — ${s.publisher}` : "" },
        ],
      })),
    },
  ];
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Weave up to `max` sources as inline links into paragraph text (mutates blocks).
 * Only splits plain text nodes, one link per paragraph, skips headings/lists.
 * Returns how many links were woven. Safe no-op when phrases don't match.
 */
export function weaveInlineLinks(blocks, sources, max = 2) {
  if (!Array.isArray(blocks) || !Array.isArray(sources)) return 0;
  let woven = 0;
  const usedParagraphs = new Set();
  for (const src of sources) {
    if (woven >= max) break;
    const phrase = (src.anchorPhrase || "").trim();
    if (phrase.length < 3) continue;
    const rx = new RegExp(`\\b${escapeRx(phrase)}\\b`, "i");
    for (const b of blocks) {
      if (b.type !== "paragraph" || !Array.isArray(b.children) || usedParagraphs.has(b)) continue;
      let done = false;
      for (let ci = 0; ci < b.children.length; ci++) {
        const c = b.children[ci];
        if (c.type !== "text" || !c.text) continue;
        const m = c.text.match(rx);
        if (!m || m.index == null) continue;
        const before = c.text.slice(0, m.index);
        const after = c.text.slice(m.index + m[0].length);
        const repl = [
          ...(before ? [{ type: "text", text: before }] : []),
          { type: "link", url: src.url, children: [{ type: "text", text: m[0] }] },
          ...(after ? [{ type: "text", text: after }] : []),
        ];
        b.children.splice(ci, 1, ...repl);
        usedParagraphs.add(b);
        woven++;
        done = true;
        break;
      }
      if (done) break;
    }
  }
  return woven;
}

/** true if any link node already exists anywhere in the blocks tree. */
export function blocksHaveLinks(blocks) {
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n?.type === "link" && n.url) return true;
      if (Array.isArray(n?.children) && walk(n.children)) return true;
    }
    return false;
  };
  return walk(blocks);
}
