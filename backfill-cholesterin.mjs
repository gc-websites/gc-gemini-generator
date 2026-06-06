// In-place backfill for cholesterintipps.de — deepens existing shallow articles
// (intro + 2 plain sections) into the rich structure: "Das Wichtigste in Kürze"
// + the 2 existing body sections (KEEPING their images) + extra sections + FAQ
// + Quellen (validated source links) + medical disclaimer. Updates each post
// via Strapi PUT (omitting component ids — Strapi v5 rejects published ids).
//
// Resumable: articles that already have the rich sections are skipped.
// Usage: node backfill-cholesterin.mjs [maxToDeepen] [startPage]

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { cholesterinConfig } from './functionsCholesterin.js';
import { buildRichParagraphs } from './functionsPostBase.js';

dotenv.config();

const API = process.env.STRAPI_API_URL;
const TOK = process.env.STRAPI_TOKEN;
const COLL = cholesterinConfig.collection; // post2s

const MAX = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
const START_PAGE = process.argv[3] ? parseInt(process.argv[3], 10) : 1;
const PAGE_SIZE = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same baseRules that generateGlobalObj builds, so deepened text matches voice.
const baseRules = `Write in ${cholesterinConfig.language}.
Brand: ${cholesterinConfig.brandName}. Voice: ${cholesterinConfig.brandVoice}.
Audience: ${cholesterinConfig.audience}.
${cholesterinConfig.topicHint || ''}`;

const blocksToText = blocks =>
  (blocks || [])
    .filter(b => b && b.type === 'paragraph')
    .map(b =>
      (b.children || [])
        .map(c =>
          c?.type === 'link'
            ? (c.children || []).map(x => x?.text || '').join('')
            : c?.text || '',
        )
        .join(''),
    )
    .filter(Boolean)
    .join('\n\n');

const RICH_MARKERS = [
  cholesterinConfig.richLabels?.keyTakeaways,
  cholesterinConfig.sources?.label,
  cholesterinConfig.richLabels?.faq,
].filter(Boolean);

const isAlreadyDeep = paragraphs =>
  (paragraphs || []).some(p =>
    RICH_MARKERS.some(m => (p.subtitle || '').trim() === m),
  );

async function getArticle(documentId) {
  const url = `${API}/api/${COLL}/${documentId}?populate[paragraphs][populate]=*`;
  const r = await fetch(url, { headers: { Authorization: TOK } });
  if (!r.ok) return null;
  return (await r.json()).data;
}

async function listPage(page) {
  const url = `${API}/api/${COLL}?fields[0]=title&sort=createdAt:asc&pagination[page]=${page}&pagination[pageSize]=${PAGE_SIZE}`;
  const r = await fetch(url, { headers: { Authorization: TOK } });
  const j = await r.json();
  return {
    ids: (j.data || []).map(d => d.documentId),
    total: j.meta?.pagination?.total || 0,
    pageCount: j.meta?.pagination?.pageCount || 0,
  };
}

async function putParagraphs(documentId, paragraphs) {
  const r = await fetch(`${API}/api/${COLL}/${documentId}`, {
    method: 'PUT',
    headers: { Authorization: TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { paragraphs } }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${r.status}: ${t.slice(0, 250)}`);
  }
  return r.json();
}

async function deepenOne(documentId) {
  const art = await getArticle(documentId);
  if (!art) return { skip: 'not found' };
  const paras = art.paragraphs || [];
  if (isAlreadyDeep(paras)) return { skip: 'already deep' };
  if (paras.length < 2) return { skip: 'too few sections' };

  const s1 = paras[0];
  const s2 = paras[1];
  const rich = await buildRichParagraphs({
    brand: cholesterinConfig.brandName,
    baseRules,
    title: art.title,
    description: blocksToText(art.description) || art.title,
    subTitleP1: s1.subtitle || 'Hintergrund',
    descrP1: blocksToText(s1.description),
    subTitleP2: s2.subtitle || 'In der Praxis',
    descrP2: blocksToText(s2.description),
    disclaimerHint: cholesterinConfig.disclaimerHint || '',
    cfg: cholesterinConfig,
  });

  const img1 = s1.image?.id || null;
  const img2 = s2.image?.id || null;
  // Rebuild components WITHOUT ids (Strapi v5 PUT rejects published component
  // ids); reattach the existing images to the two body sections.
  const out = rich.map(p => {
    const o = { subtitle: p.subtitle, description: p.description };
    const img = p._img === 'b1' ? img1 : p._img === 'b2' ? img2 : null;
    if (img) o.image = img;
    return o;
  });

  await putParagraphs(documentId, out);
  return { ok: true, sections: out.length, title: art.title };
}

const first = await listPage(START_PAGE);
console.log(
  `Total ${COLL}: ${first.total}; pages: ${first.pageCount}. Deepening up to ${MAX} from page ${START_PAGE}.\n`,
);

let deepened = 0,
  skipped = 0,
  failed = 0,
  processed = 0;

for (let page = START_PAGE; page <= first.pageCount && deepened < MAX; page++) {
  const { ids } = page === START_PAGE ? first : await listPage(page);
  for (const id of ids) {
    if (deepened >= MAX) break;
    processed++;
    try {
      const r = await deepenOne(id);
      if (r.ok) {
        deepened++;
        console.log(`✓ [${deepened}] ${(r.title || '').slice(0, 55)} (${r.sections} sections)`);
        await sleep(1500);
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      console.error(`✗ ${id}: ${e.message}`);
      await sleep(1500);
    }
  }
  console.log(`  … page ${page} done (deepened ${deepened}, skipped ${skipped}, failed ${failed})`);
}

console.log(`\n===== DONE =====\ndeepened: ${deepened}\nskipped (already deep / too few): ${skipped}\nfailed: ${failed}\nprocessed: ${processed}`);
