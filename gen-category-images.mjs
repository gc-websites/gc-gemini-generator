import { GoogleGenAI } from '@google/genai';
import FormData from 'form-data';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;
const PUB = 'https://vivid-triumph-4386b82e17.strapiapp.com/api';
const imagen = new GoogleGenAI(GEMINI_API_KEY);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const ONLY = process.env.ONLY || '';

const photoRules = `Style: ultra-realistic editorial photograph, shot on a 50mm DSLR, natural soft lighting, shallow depth of field, photojournalism aesthetic.
Forbidden: illustrations, CGI, 3D renders, cartoons, fantasy, surrealism, embedded text, visible logos, watermarks, brand names, distorted hands or faces, anyone who looks under 50.
Composition: rule of thirds, eye-level, color-graded warm midtones, a striking magazine-cover-quality square frame. Hair is the visual anchor.`;
const context = `HairStylesForSeniors.com — a friendly hair-care site for adults 50+. Soft editorial photography of REAL seniors (55-75), in salons, real bathrooms, vanities and living rooms. Never youthful models.`;
const palette = `warm neutrals, soft champagne and rose, gentle silver highlights, muted lavender accents, natural daylight, no harsh shadows. Hair (silver, salt-and-pepper, soft gray, brunette streaked with white) looks elegant and luminous, never aged-into.`;

const build = scene => `${photoRules}\nSite context: ${context}\nColour and mood palette: ${palette}\n\n${scene}`;

const CATS = [
  { id: 'khzmk73e535ds3jtyqducscv', name: "Women's Hairstyles for Seniors",
    scene: `Scene: a radiant woman aged 62-70 with a beautifully styled soft silver and salt-and-pepper layered bob, glossy and full of movement, seated in a sunlit salon chair, half-turned to a mirror, looking serene and confident. Warm, flattering window light. Her elegant hairstyle is the hero of the frame.` },
  { id: 'rlw17v0ct9p6mdrddycy87hy', name: "Men's Hairstyles for Seniors",
    scene: `Scene: a distinguished man aged 60-72 with a sharp, modern silver haircut — tight tapered sides and a little textured length on top — and a neatly groomed matching silver beard, in a warm modern barbershop, looking self-possessed and handsome. His crisp cut is the focus.` },
  { id: 'y793qodqzj4or7sb40nl6pob', name: 'Hair Care for Seniors',
    scene: `Scene: an intimate close-up of a woman aged 60-70 gently working a nourishing conditioner through soft gray mid-lengths at a sunlit bathroom basin, fingertips smoothing the hair, water droplets catching the light. Tender, caring, spa-like mood. Hands and healthy hair are the anchor.` },
  { id: 'ydn6vrp5ostcqohgixc5bsru', name: 'Special Occasion Hairstyles for Seniors',
    scene: `Scene: an elegant woman aged 65-72 with a sophisticated low chignon updo dressed with a delicate pearl hairpin and a few soft face-framing tendrils of silver hair, dressed for a celebration, soft golden glamour lighting. Refined, joyful, magazine-cover poise. The polished updo is the hero.` },
  { id: 'tupkdf0d38282lqkm14mfkjt', name: 'Hair Styling Tutorials for Seniors',
    scene: `Scene: a woman aged 60-68 styling her own silver hair at a bright vanity mirror, mid-action, lifting a section at the crown with a round brush and a handheld dryer for volume, focused and pleased. Real bedroom vanity, warm daylight. The hands-on styling moment is the anchor.` },
  { id: 'fvbej605yxnmajii0kph8elh', name: 'Hair Tools & Products for Seniors',
    scene: `Scene: a beautiful flat-lay still life of senior hair-care essentials on a pale marble counter — a wooden wide-tooth comb, a boar-bristle brush, two amber and frosted-glass product bottles with NO readable labels, a soft folded towel, a sprig of dried lavender and a few rose petals. Soft even daylight, warm neutrals, sidebar-worthy composition. No people.` },
  { id: 'vy2fkc87h9qb7tcleij20eec', name: 'Hair Problems & Solutions for Seniors',
    scene: `Scene: a thoughtful, reassured woman aged 60-70 gently checking her fine, slightly thinning silver hair along the part in a softly lit mirror, calm and hopeful expression — warm and human, NOT clinical. Cozy bathroom, gentle morning light. The caring self-examination of healthy-looking hair is the anchor.` },
  { id: 'e8aogrk4t2nfhc10ldqdw5pe', name: 'Inspiration & Gallery for Seniors',
    scene: `Scene: a striking magazine-cover portrait of a woman aged 65-75 with gorgeous, luminous natural-age silver hair beautifully cut and styled, grounded and self-possessed, against a soft neutral champagne backdrop. Aspirational but real — "that could be me on a good day". The stunning silver hair is the hero.` },
  { id: 'jrm5opwlocbpqoldbt1y1iku', name: 'Reviews & Recommendations for Seniors',
    scene: `Scene: a woman aged 60-70 with soft gray hair thoughtfully comparing two hair-care product bottles (NO readable labels) held up in a bright, airy room, considering with a pleasant expression, products and her healthy hair both in frame. Warm trustworthy editorial mood.` },
];

const run = async () => {
  let cats = CATS;
  if (ONLY) cats = cats.filter(c => c.id === ONLY);
  cats = cats.slice(0, LIMIT);
  for (const c of cats) {
    try {
      // current image (for backup/reference)
      const before = ((await (await fetch(`${PUB}/category3s?filters[documentId][$eq]=${c.id}&populate[image][fields][0]=url`)).json()).data)?.[0];
      if (!process.env.FORCE && /category[_-]/i.test(before?.image?.url || '')) { console.log(`SKIP ${c.name} (already has a generated image)`); continue; }
      const resp = await imagen.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: build(c.scene),
        config: { numberOfImages: 1, aspectRatio: '1:1', outputMimeType: 'image/png' },
      });
      const gen = resp.generatedImages?.[0];
      if (!gen?.image?.imageBytes) { console.warn(`[${c.name}] no image data`, resp?.error || ''); continue; }
      const buffer = Buffer.from(gen.image.imageBytes, 'base64');
      const fd = new FormData();
      const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      fd.append('files', buffer, { filename: `category-${slug}.png`, contentType: 'image/png' });
      const up = await fetch(`${STRAPI_API_URL}/api/upload`, { method: 'POST', headers: { Authorization: STRAPI_TOKEN }, body: fd });
      const upJson = await up.json();
      const newId = Array.isArray(upJson) ? upJson[0]?.id : null;
      if (!newId) { console.warn(`[${c.name}] upload failed`, JSON.stringify(upJson).slice(0, 200)); continue; }

      const put = await fetch(`${STRAPI_API_URL}/api/category3s/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: STRAPI_TOKEN }, body: JSON.stringify({ data: { image: newId } }) });
      if (put.status >= 300) { console.warn(`[${c.name}] PUT ${put.status}: ${(await put.text()).slice(0, 160)}`); continue; }
      const after = ((await (await fetch(`${PUB}/category3s?filters[documentId][$eq]=${c.id}&populate[image][fields][0]=url`)).json()).data)?.[0];
      const ok = after?.image?.url && after.image.url !== before?.image?.url;
      console.log(`${ok ? 'OK  ' : 'WARN'} ${c.name}  -> imageId=${newId}  ${after?.image?.url || ''}`);
    } catch (e) { console.error(`[${c.name}] error: ${e.message}`); }
  }
};
run();
