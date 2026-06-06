export const meta = {
  name: 'chol-deepen-batch',
  description: 'Claude-authored deepening of cholesterin articles (no Gemini)',
  phases: [{ title: 'Author', detail: 'one Claude subagent per article' }],
}

const ids = __IDS__;

const POOL = [
  'https://www.herzstiftung.de/',
  'https://www.gesundheitsinformation.de/cholesterin.html',
  'https://www.apotheken-umschau.de/gesundheit/krankheiten/cholesterin',
  'https://www.internisten-im-netz.de/krankheiten/fettstoffwechselstoerungen.html',
  'https://www.internisten-im-netz.de/krankheiten/fettstoffwechselstoerungen/cholesterin.html',
  'https://www.gelbe-liste.de/wirkstoffgruppen/statine',
  'https://www.dge.de/',
  'https://www.heart.org/en/health-topics/cholesterol',
  'https://www.who.int/health-topics/cardiovascular-diseases',
  'https://www.aerzteblatt.de/',
  'https://www.pharmazeutische-zeitung.de/',
  'https://www.gesundheitsinformation.de/',
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['documentId', 'keyTakeaways', 'extraSections', 'faq', 'sources'],
  properties: {
    documentId: { type: 'string' },
    keyTakeaways: { type: 'array', minItems: 4, maxItems: 5, items: { type: 'string' } },
    extraSections: {
      type: 'array', minItems: 2, maxItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        required: ['heading', 'paragraphs', 'list', 'listOrdered'],
        properties: {
          heading: { type: 'string' },
          paragraphs: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
          list: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } },
          listOrdered: { type: 'boolean' },
        },
      },
    },
    faq: {
      type: 'array', minItems: 3, maxItems: 5,
      items: {
        type: 'object', additionalProperties: false,
        required: ['question', 'answer'],
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
      },
    },
    sources: { type: 'array', minItems: 3, maxItems: 4, items: { type: 'string', enum: POOL } },
  },
}

const guide = (id) => `Du bist erfahrene/r deutsche/r Gesundheitsredakteur/in bei CholesterinTipps (cholesterintipps.de), einem seriösen Ratgeber zu Cholesterin & Herzgesundheit für Erwachsene 40–70. Stil: sachlich-warm, vertrauenswürdig, direkte Ansprache mit "Sie". Keine Panikmache, keine Heilsversprechen, Heilmittelwerbegesetz-konform.

SCHRITT 1 — Hole den bestehenden Artikel (öffentliche API, kein Token nötig):
curl -s "https://vivid-triumph-4386b82e17.strapiapp.com/api/post2s/${id}?populate%5Bparagraphs%5D%5Bpopulate%5D=*"
Im JSON: data.title = Titel; data.description = Intro (blocks); data.paragraphs[0] und data.paragraphs[1] = die zwei bestehenden Abschnitte (subtitle + description). Lies Titel, Intro und beide Abschnitte, um Thema und Tonfall zu verstehen.

SCHRITT 2 — Schreibe NUR die folgenden NEUEN, vertiefenden Teile auf Deutsch, spezifisch zu DIESEM Artikel. Wiederhole NICHT die beiden bestehenden Abschnitte.
- keyTakeaways: 4–5 konkrete, umsetzbare Kernaussagen (echte Zahlen/Richtwerte wo sinnvoll, z. B. LDL-Zielwerte, Mengen, Häufigkeiten) — keine Floskeln.
- extraSections: GENAU 2 neue Abschnitte. Gute Formen: eine nummerierte Schritt-für-Schritt-Anleitung; "Häufige Fehler, die Sie vermeiden sollten"; "Cholesterinwerte richtig deuten"; oder gruppenspezifische Hinweise. Jeder: heading, paragraphs (1–2 Sätze), list (konkrete Schritte/Tipps), listOrdered (true bei Schritt-für-Schritt, sonst false).
- faq: 3–5 echte Leserfragen mit je 2–4 Sätzen präziser Antwort. Wo es um Werte, Medikamente (z. B. Statine) oder Risiken geht, ergänze einen kurzen, warmen Hinweis, dies ärztlich abklären zu lassen.
- sources: wähle 3–4 für DIESES Thema relevante URLs AUSSCHLIESSLICH aus dieser Liste (exakt diese URL-Strings, erfinde KEINE):
${POOL.map(u => '  - ' + u).join('\n')}

Gib documentId = "${id}" zurück. Antworte ausschließlich über das StructuredOutput-Tool.`

phase('Author')
const results = await parallel(
  ids.map(id => () =>
    agent(guide(id), { label: `deepen:${id.slice(0, 8)}`, phase: 'Author', schema: SCHEMA })
      .then(r => (r ? { ...r, documentId: r.documentId || id } : null)),
  ),
)

const ok = results.filter(Boolean)
log(`Authored ${ok.length}/${ids.length} articles`)
return { authored: ok }
