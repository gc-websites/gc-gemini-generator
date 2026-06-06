// hairstylesforseniors.com — English-language hair care, hairstyles,
// color and confidence for adults 50+. Voice is warm and friendly,
// like a hairdresser who's been cutting your hair for 20 years.

import { generateAndPostForSite } from './functionsPostBase.js';

const hairStylesConfig = {
  brandName: 'HairStylesForSeniors',
  // Deep articles: Key Takeaways + body sections + step-by-step / mistakes +
  // FAQ, rendered as proper Strapi blocks, with 3 full-frame images (no voids).
  richContent: true,
  language: 'English',
  audience:
    'English-speaking adults aged 50–75 (more women than men, but write inclusively) interested in age-appropriate hairstyles, gentle hair care, gray coverage, hair thinning, products and confidence tips',
  brandVoice:
    'warm, friendly, hairdresser-who-knows-you tone. Plain, encouraging language. Real-life examples ("a client I had last week…"). Never condescending about aging — celebrates it. No pressure to look younger; the goal is to look like the best version of yourself.',
  topicHint:
    'Write the kind of article a 60-year-old reader would read with her morning coffee and forward to a friend. Specific, sensory details (the smell of a salon, the texture of fine hair, the weight of a good brush). Mention real techniques, not just generic "use good products" advice.',
  disclaimerHint:
    'When the topic touches scalp conditions, medication side effects or significant hair loss, briefly note that a dermatologist is the right next step — keep it warm and one sentence.',

  collection: 'post3s',
  authorField: 'author_3',
  categoryField: 'category_3',
  defaultAuthor: 1,

  categories: [
    "Women's Hairstyles for Seniors",
    "Men's Hairstyles for Seniors",
    'Hair Care for Seniors',
    'Special Occasion Hairstyles for Seniors',
    'Hair Styling Tutorials for Seniors',
    'Hair Tools & Products for Seniors',
    'Hair Problems & Solutions for Seniors',
    'Inspiration & Gallery for Seniors',
    'Reviews & Recommendations for Seniors',
  ],
  categoryIds: {
    "Women's Hairstyles for Seniors": 1,
    "Men's Hairstyles for Seniors": 3,
    'Hair Care for Seniors': 5,
    'Special Occasion Hairstyles for Seniors': 7,
    'Hair Styling Tutorials for Seniors': 9,
    'Hair Tools & Products for Seniors': 11,
    'Hair Problems & Solutions for Seniors': 13,
    'Inspiration & Gallery for Seniors': 15,
    'Reviews & Recommendations for Seniors': 17,
  },

  imagePrefix: 'hairstyles',

  // Visual identity — older adults in real life. Salons, mirrors,
  // products, soft natural lighting. NEVER overly youthful.
  imageStyle: {
    context:
      'HairStylesForSeniors.com is a friendly hair-care site for adults 50+. Photography style: soft editorial, real seniors (NEVER models under 50 in lead roles), salons, real bathrooms, real living rooms.',
    palette:
      'warm neutrals, soft champagne and rose, gentle silver highlights, muted lavender accents. Natural daylight, no harsh shadows. Hair textures (silver, salt-and-pepper, soft gray, brunette streaked with white) should look elegant, not aged-into.',

    subjectClose:
      'close-up of a hair-related detail: silver hair being combed, hands applying conditioner, a wide-tooth wooden comb on a marble counter, fingertips at the temples, a single curl held between fingers.',
    settingClose:
      'a real bathroom counter, a vanity mirror, a salon station, or a kitchen window with morning light. Lived-in textures.',
    moodClose: 'intimate, gentle, almost meditative.',

    subjectAction:
      'a woman or man aged 55–75 doing something hair-related at home or in a salon: a stylist trimming silver hair, a senior styling her own hair at a mirror, a man checking his beard line, hands separating sections of hair.',
    settingAction:
      'a warm modern salon, a sunlit bathroom, a comfortable bedroom vanity, or a porch with a hand-mirror. Real chairs, real towels, real products on shelves.',
    moodAction: 'confident, relaxed, present.',

    subjectHero:
      'a striking portrait or scene of an adult 55–75 with beautiful natural-age hair — silver, salt-and-pepper, soft gray, or warm-toned dyed hair. The person looks grounded and self-possessed, NOT trying to look younger.',
    settingHero:
      'a salon chair with magazine-cover styling, a sunlit window, a quiet living room, or a portrait against a soft neutral background. The hair must be the visual anchor.',
    moodHero:
      'aspirational but real. The kind of image a 60-year-old looks at and thinks "that could be me, on a good day."',

    subjectProduct:
      'still life of hair-care items: a wooden brush on a marble counter, a row of shampoo bottles (no readable brand text), a curling iron warming up, fresh towels and a comb, dry rose petals beside a bottle of hair oil.',
    settingProduct:
      'flat lay or 3/4 angle on stone, linen or polished wood. Soft, even light. Composition that could live as a sidebar.',

    subjectLifestyle:
      'a candid mid-shot of an adult 55–75 in a relaxed lifestyle moment — laughing with a friend, looking out a window, walking with a small dog, having coffee with a granddaughter — where the hair is visible but not the only subject.',
    settingLifestyle:
      'real home, café, park or city street. Hair clearly visible, lighting flattering. Distinctly different feel from the product still life.',
  },
};

export async function generateAndPostHairStyles() {
  return generateAndPostForSite(hairStylesConfig);
}

export { hairStylesConfig };
