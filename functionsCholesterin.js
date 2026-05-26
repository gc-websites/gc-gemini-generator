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
