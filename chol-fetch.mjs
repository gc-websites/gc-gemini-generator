// Fetch the next N not-yet-deepened cholesterin articles (their title + intro +
// the 2 existing body sections as plain text) into a JSON batch file, for the
// Claude-authored deepening workflow. Resumable: skips already-deep articles.
//
// Usage: node chol-fetch.mjs [N] [outFile]

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import { cholesterinConfig } from './functionsCholesterin.js';

dotenv.config();
const API = process.env.STRAPI_API_URL;
const TOK = process.env.STRAPI_TOKEN;
const COLL = cholesterinConfig.collection;

const N = parseInt(process.argv[2] || '4', 10);
const OUT = process.argv[3] || 'chol-batch.json';

const RICH = [
  cholesterinConfig.richLabels?.keyTakeaways,
  cholesterinConfig.sources?.label,
  cholesterinConfig.richLabels?.faq,
].filter(Boolean);
const isDeep = ps =>
  (ps || []).some(p => RICH.some(m => (p.subtitle || '').trim() === m));

const text = blocks =>
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

const out = [];
let page = 1;
let scanned = 0;
while (out.length < N) {
  const r = await fetch(
    `${API}/api/${COLL}?populate[paragraphs][populate]=*&sort=createdAt:asc&pagination[page]=${page}&pagination[pageSize]=20`,
    { headers: { Authorization: TOK } },
  );
  const j = await r.json();
  const data = j.data || [];
  if (!data.length) break;
  for (const a of data) {
    if (out.length >= N) break;
    scanned++;
    const ps = a.paragraphs || [];
    if (isDeep(ps) || ps.length < 2) continue;
    out.push({
      documentId: a.documentId,
      title: a.title,
      category: a.category_2?.name || '',
      intro: text(a.description).slice(0, 700),
      s1: { subtitle: ps[0].subtitle, text: text(ps[0].description).slice(0, 900) },
      s2: { subtitle: ps[1].subtitle, text: text(ps[1].description).slice(0, 900) },
    });
  }
  if (page >= (j.meta?.pagination?.pageCount || 1)) break;
  page++;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`scanned ${scanned}, wrote ${out.length} not-yet-deep articles to ${OUT}`);
