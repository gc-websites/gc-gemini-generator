// cholesterintipps.de — German-language site about cholesterol, heart
// health, and lifestyle changes for people 40–70 managing cholesterol.
// Voice is German-language, careful and trustworthy, like a health
// magazine you'd actually pick up at the Apotheke.

import { generateAndPostForSite } from './functionsPostBase.js';

const cholesterinConfig = {
  brandName: 'CholesterinTipps',
  language: 'German',
  audience:
    'German-speaking adults aged 40–70 who are managing — or want to prevent — high cholesterol; many of them are also thinking about heart health, weight, blood pressure and a Mediterranean-leaning diet',
  brandVoice:
    'sachlich-warm und vertrauenswürdig wie ein gutes Apotheken-Heftchen. Klare, geerdete Sprache. Keine Panikmache, keine Heilsversprechen. Quellen werden angedeutet, nicht ausgeschmückt. Direkte Ansprache mit "Sie".',
  topicHint:
    'Schreibe so, als würdest du einem aufgeklärten, leicht skeptischen deutschsprachigen Leser etwas erklären, der schon viel gelesen hat. Konkrete Beispiele und Alltagsbezug bevorzugen. Statin-Themen sachlich behandeln, Ernährungstipps konkret und alltagstauglich.',
  disclaimerHint:
    'Wo es um Cholesterinwerte, Medikamente oder gesundheitliche Risiken geht, in einem Halbsatz erwähnen, dass der Artikel informativ ist und einen Arztbesuch nicht ersetzt — niemals als langer juristischer Hinweis.',

  // Deep, German, medical (YMYL) articles: "Das Wichtigste in Kürze" + body
  // sections + step-by-step / Fehler + FAQ + a "Quellen" section with REAL
  // outbound links to credible German/international health authorities, plus a
  // standing medical disclaimer (Heilmittelwerbegesetz / E-E-A-T).
  richContent: true,
  richEditorPersona: 'erfahrene/r Gesundheitsredakteur/in mit medizinischem Hintergrund',
  richWriterPersona: 'erfahrene/r, medizinisch versierte/r Gesundheitsredakteur/in',
  richFaqPersona: 'medizinisch fundierte/r Cholesterin- und Ernährungsexperte/in',
  richSectionShapes:
    'eine nummerierte Schritt-für-Schritt-Anleitung; "Häufige Fehler, die Sie vermeiden sollten"; "Cholesterinwerte richtig deuten"; oder "Worauf bestimmte Gruppen (z. B. ältere Menschen, Diabetiker) achten sollten" — konkret, alltagstauglich, mit echten Zahlen/Richtwerten wo sinnvoll',
  richFaqReferral:
    'Wo eine Antwort konkrete Cholesterinwerte, Medikamente (z. B. Statine) oder gesundheitliche Risiken berührt, füge einen kurzen, warmen Hinweis hinzu, dies mit der Hausärztin / dem Hausarzt abzuklären.',
  richLabels: {
    keyTakeaways: 'Das Wichtigste in Kürze',
    faq: 'Häufig gestellte Fragen',
  },
  sources: {
    label: 'Quellen',
    intro:
      'Verlässliche, weiterführende Informationen zu diesem Thema finden Sie bei diesen Institutionen:',
    domains: [
      'herzstiftung.de',
      'dge.de',
      'apotheken-umschau.de',
      'rki.de',
      'gesundheitsinformation.de',
      'gelbe-liste.de',
      'internisten-im-netz.de',
      'aerzteblatt.de',
      'pharmazeutische-zeitung.de',
      'who.int',
      'heart.org',
      'ahajournals.org',
      'mayoclinic.org',
      'ncbi.nlm.nih.gov',
    ],
    prompt:
      'Bevorzuge offizielle deutschsprachige Gesundheitsquellen: Deutsche Herzstiftung, Deutsche Gesellschaft für Ernährung (DGE), Apotheken-Umschau, Robert Koch-Institut, IQWiG (gesundheitsinformation.de), Gelbe Liste, internisten-im-netz.de, Deutsches Ärzteblatt. Ergänzend etablierte internationale Quellen: American Heart Association, Mayo Clinic, WHO, PubMed. Keine Foren, keine Shops, keine Blogs.',
  },
  medicalDisclaimerLabel: 'Wichtiger Hinweis',
  medicalDisclaimerBlock:
    'Dieser Beitrag dient ausschließlich der Information und ersetzt keine ärztliche Beratung, Diagnose oder Behandlung. Bitte lassen Sie erhöhte Cholesterinwerte und Entscheidungen über Medikamente oder Therapien immer ärztlich abklären.',

  collection: 'post2s',
  authorField: 'author_2',
  categoryField: 'category_2',
  defaultAuthor: 1,

  categories: [
    'Aktuelle Forschung & Studien zum Cholesterin',
    'Alltagstipps für ein cholesterinfreundliches Leben',
    'Erfahrungsberichte & Interviews zum Thema Cholesterin',
    'Ernährung & Lebensstil bei Cholesterinproblemen',
    'Grundlagen & Hintergründe',
    'Mythen & Fakten rund ums Cholesterin',
    'Prävention & Screening von Cholesterinwerten',
    'Spezielle Zielgruppen mit Cholesterin-Thematik',
    'Therapie & Medikamente gegen hohen Cholesterin',
    'Ursachen & Risikofaktoren für erhöhtes Cholesterin',
  ],
  categoryIds: {
    'Aktuelle Forschung & Studien zum Cholesterin': 8,
    'Alltagstipps für ein cholesterinfreundliches Leben': 9,
    'Erfahrungsberichte & Interviews zum Thema Cholesterin': 10,
    'Ernährung & Lebensstil bei Cholesterinproblemen': 3,
    'Grundlagen & Hintergründe': 1,
    'Mythen & Fakten rund ums Cholesterin': 7,
    'Prävention & Screening von Cholesterinwerten': 5,
    'Spezielle Zielgruppen mit Cholesterin-Thematik': 6,
    'Therapie & Medikamente gegen hohen Cholesterin': 4,
    'Ursachen & Risikofaktoren für erhöhtes Cholesterin': 2,
  },

  imagePrefix: 'cholesterin',

  // Visual identity — German/Central European setting, kitchens, doctor
  // offices, food prep, mature adults. Warm, calm, slightly clinical.
  imageStyle: {
    context:
      'CholesterinTipps.de is a German health information site about cholesterol and heart-friendly living. Photography style: editorial health magazine, Central European setting, calm and trustworthy.',
    palette:
      'soft sage greens, oat-cream, muted brick. Honest natural light. Mediterranean-friendly food colors when food is shown (olive oil, fresh greens, oily fish, whole grains, nuts, berries).',

    // Cholesterin overrides the hairstyles image defaults (rich image prompts).
    anchorLine:
      'Heart-friendly food, calm Central-European everyday scenes and mature adults are the visual anchor.',
    peopleConstraint:
      'People shown are healthy-looking Central European adults aged 45–70. No fear-mongering imagery (no clutching chest, no red alarm signs, no shock).',

    subjectClose:
      'close-up of cholesterol-relevant detail: olive oil drizzling on a salad, a blood-pressure cuff on a wrist, a slice of whole-grain bread, the label of a medicine box (no readable text), hand holding a fork over a healthy plate.',
    settingClose:
      'a real German or Austrian kitchen, a Hausarzt practice counter, a wooden cutting board, a pharmacy shelf. Clean, lived-in, not over-styled.',
    moodClose: 'calm, evidence-based, like a Stiftung-Warentest editorial frame.',

    subjectAction:
      'a German-speaking adult aged 45–70 doing something concrete that supports heart health: preparing fish, walking with Nordic poles, reading a nutrition label at a Supermarkt, stretching at home.',
    settingAction:
      'a real-feeling Central European home, a market hall (Markthalle), a footpath through a park, an apothecary, a doctor\'s waiting room.',
    moodAction: 'practical, hopeful, gentle determination.',

    subjectHero:
      'a thoughtful Central European adult aged 50–68 in a hero moment that hints at the article story — at the kitchen table, in conversation, or in a quiet outdoor pause.',
    settingHero:
      'kitchen with morning light, balcony in a German city, a clinical-but-warm doctor\'s office, or an outdoor walking path with autumn light.',
    moodHero:
      'trustworthy, magazine-cover quality, gentle hope. No fear-mongering imagery (no clutching chest, no red warning signs).',

    subjectProduct:
      'still life of heart-friendly food or relevant items: oats and berries in a bowl, omega-3 capsules on a wooden surface, a blood-pressure monitor next to a notebook, fresh herbs on linen.',
    settingProduct:
      'flat lay or 3/4 angle on light wood, linen, or stone. Soft side light.',

    subjectLifestyle:
      'a candid wide shot of a German-speaking adult relaxing in a healthy context — coffee at the window, slow walk with grandchildren, sitting on a balcony with a book.',
    settingLifestyle:
      'distinctly European setting: Altbau apartment, market square, Spaziergang in a park. Different feel from the product image.',
  },
};

export async function generateAndPostCholesterin() {
  return generateAndPostForSite(cholesterinConfig);
}

export { cholesterinConfig };
