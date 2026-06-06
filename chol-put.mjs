// Assembles the Claude-authored deepening into Strapi "blocks" and PUTs each
// cholesterin article in place — keeping the existing intro + 2 body sections
// (and their images), adding "Das Wichtigste in Kürze" + 2 extra sections + FAQ
// + Quellen (curated links) + a medical disclaimer. Omits component ids so
// Strapi v5 accepts the PUT. Resumable: skips articles already deep.
//
// Usage: node chol-put.mjs <authored.json>

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import { cholesterinConfig } from './functionsCholesterin.js';

dotenv.config();
const API = process.env.STRAPI_API_URL;
const TOK = process.env.STRAPI_TOKEN;
const COLL = cholesterinConfig.collection;

const cfg = cholesterinConfig;
const L_KT = cfg.richLabels?.keyTakeaways || 'Das Wichtigste in Kürze';
const L_FAQ = cfg.richLabels?.faq || 'Häufig gestellte Fragen';
const L_SRC = cfg.sources?.label || 'Quellen';
const SRC_INTRO = cfg.sources?.intro || '';
const L_DISC = cfg.medicalDisclaimerLabel || 'Wichtiger Hinweis';
const DISC = cfg.medicalDisclaimerBlock || '';

// url -> human title for the Quellen list
const SOURCE_TITLES = {
  'https://www.herzstiftung.de/': 'Deutsche Herzstiftung',
  'https://www.gesundheitsinformation.de/cholesterin.html': 'IQWiG – Cholesterin (gesundheitsinformation.de)',
  'https://www.apotheken-umschau.de/gesundheit/krankheiten/cholesterin': 'Apotheken Umschau – Cholesterin',
  'https://www.internisten-im-netz.de/krankheiten/fettstoffwechselstoerungen.html': 'Internisten im Netz – Fettstoffwechselstörungen',
  'https://www.internisten-im-netz.de/krankheiten/fettstoffwechselstoerungen/cholesterin.html': 'Internisten im Netz – Cholesterin',
  'https://www.gelbe-liste.de/wirkstoffgruppen/statine': 'Gelbe Liste – Statine',
  'https://www.dge.de/': 'Deutsche Gesellschaft für Ernährung (DGE)',
  'https://www.heart.org/en/health-topics/cholesterol': 'American Heart Association – Cholesterol',
  'https://www.who.int/health-topics/cardiovascular-diseases': 'WHO – Herz-Kreislauf-Erkrankungen',
  'https://www.aerzteblatt.de/': 'Deutsches Ärzteblatt',
  'https://www.pharmazeutische-zeitung.de/': 'Pharmazeutische Zeitung',
  'https://www.gesundheitsinformation.de/': 'IQWiG – gesundheitsinformation.de',
};

const mkPara = t => ({ type: 'paragraph', children: [{ type: 'text', text: String(t) }] });
const mkHeading = (t, level = 3) => ({ type: 'heading', level, children: [{ type: 'text', text: String(t) }] });
const mkList = (items, ordered = false) => ({
  type: 'list',
  format: ordered ? 'ordered' : 'unordered',
  children: (items || []).filter(Boolean).map(t => ({ type: 'list-item', children: [{ type: 'text', text: String(t) }] })),
});
const mkLink = (text, url) => ({ type: 'link', url: String(url), children: [{ type: 'text', text: String(text) }] });
const mkLinkList = urls => ({
  type: 'list',
  format: 'unordered',
  children: (urls || []).filter(Boolean).map(u => ({
    type: 'list-item',
    children: [mkLink(SOURCE_TITLES[u] || u, u)],
  })),
});
// rebuild an existing block array stripped of ids (Strapi PUT rejects them)
const cleanBlocks = blocks => JSON.parse(JSON.stringify(blocks || []));

const RICH = [L_KT, L_SRC, L_FAQ];
const isDeep = ps => (ps || []).some(p => RICH.some(m => (p.subtitle || '').trim() === m));

async function getArticle(id) {
  const r = await fetch(`${API}/api/${COLL}/${id}?populate[paragraphs][populate]=*`, { headers: { Authorization: TOK } });
  if (!r.ok) return null;
  return (await r.json()).data;
}

async function putParagraphs(id, paragraphs) {
  const r = await fetch(`${API}/api/${COLL}/${id}`, {
    method: 'PUT',
    headers: { Authorization: TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { paragraphs } }),
  });
  if (!r.ok) throw new Error(`PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const authored = JSON.parse(fs.readFileSync(process.argv[2] || 'chol-authored.json', 'utf8'));
const items = authored.authored || authored;

let ok = 0, skip = 0, fail = 0;
for (const a of items) {
  try {
    const art = await getArticle(a.documentId);
    if (!art) { fail++; console.log(`✗ ${a.documentId}: not found`); continue; }
    const ps = art.paragraphs || [];
    if (isDeep(ps)) { skip++; continue; }
    if (ps.length < 2) { skip++; continue; }
    const s1 = ps[0], s2 = ps[1];

    const out = [];
    if ((a.keyTakeaways || []).length >= 2) {
      out.push({ subtitle: L_KT, description: [mkList(a.keyTakeaways)] });
    }
    out.push({ subtitle: s1.subtitle, description: cleanBlocks(s1.description), ...(s1.image?.id ? { image: s1.image.id } : {}) });
    out.push({ subtitle: s2.subtitle, description: cleanBlocks(s2.description), ...(s2.image?.id ? { image: s2.image.id } : {}) });
    for (const sec of a.extraSections || []) {
      if (!sec || !sec.heading) continue;
      const desc = [...(sec.paragraphs || []).filter(Boolean).map(mkPara)];
      if ((sec.list || []).filter(Boolean).length) desc.push(mkList(sec.list, !!sec.listOrdered));
      if (desc.length) out.push({ subtitle: sec.heading, description: desc });
    }
    const faq = (a.faq || []).filter(f => f && f.question && f.answer);
    if (faq.length >= 2) {
      out.push({ subtitle: L_FAQ, description: faq.flatMap(f => [mkHeading(f.question, 3), mkPara(f.answer)]) });
    }
    const sources = [...new Set((a.sources || []).filter(u => SOURCE_TITLES[u]))];
    if (sources.length >= 2) {
      out.push({ subtitle: L_SRC, description: [...(SRC_INTRO ? [mkPara(SRC_INTRO)] : []), mkLinkList(sources)] });
    }
    if (DISC) out.push({ subtitle: L_DISC, description: [mkPara(DISC)] });

    await putParagraphs(a.documentId, out);
    ok++;
    console.log(`✓ ${a.documentId}: ${out.length} sections (${(art.title || '').slice(0, 50)})`);
  } catch (e) {
    fail++;
    console.error(`✗ ${a.documentId}: ${e.message}`);
  }
}
console.log(`\nDONE: ${ok} updated, ${skip} skipped, ${fail} failed`);
