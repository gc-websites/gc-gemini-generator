// One-time seed for MK Learn (post7 family): 4 categories + 3 authors with
// AI-generated avatars. Idempotent — skips anything that already exists.
// Run: node --env-file=.env seed-mklearn.mjs
import { geminiImage } from "./coverImage.js";

const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer "

const CATEGORIES = [
  { slug: "what-is", name: "What Is", description: "Core concepts decoded — finance, credit and education terms explained without the jargon." },
  { slug: "online-courses", name: "Online Courses", description: "Honest breakdowns of certificates, bootcamps and university programs you can take from anywhere." },
  { slug: "student-loans", name: "Student Loans", description: "Borrowing for an education — and paying it back — explained step by step." },
  { slug: "reviews", name: "Reviews", description: "Hands-on looks at lenders, platforms and financial products, with the fine print read for you." },
];

const AUTHORS = [
  {
    name: "Daniel Mercer", slug: "daniel-mercer", role: "Education Finance Writer",
    bioText: "Daniel spent eight years explaining loan paperwork to first-generation students before turning that patience into plain-language guides. He reads the fine print so you don't have to, and believes no one should sign a promissory note they don't understand.",
    avatarScene: "Warm editorial portrait photograph of a friendly man in his late 30s with short brown hair and a casual navy sweater, soft window light, neutral studio background, approachable confident smile",
  },
  {
    name: "Amara Osei", slug: "amara-osei", role: "Online Learning Analyst",
    bioText: "Amara has completed more online courses than she can count — and dropped just as many. She reviews platforms, certificates and bootcamps with one question in mind: will this actually move your career forward, or just decorate your feed?",
    avatarScene: "Warm editorial portrait photograph of a cheerful Black woman in her early 30s with natural curly hair and a mustard-yellow blouse, soft diffused light, neutral studio background, bright genuine smile",
  },
  {
    name: "Sofia Lindgren", slug: "sofia-lindgren", role: "Careers & Courses Editor",
    bioText: "A former university admissions adviser, Sofia writes about the messy middle between education and employment — choosing programs, weighing costs, and turning study time into paychecks. She favors evidence over hype and checklists over vague advice.",
    avatarScene: "Warm editorial portrait photograph of a thoughtful Scandinavian woman in her 40s with shoulder-length blonde hair and a light-grey blazer, soft natural light, neutral studio background, calm warm expression",
  },
];

async function strapi(path, init = {}) {
  const res = await fetch(`${STRAPI_URL}/api/${path}`, {
    ...init,
    headers: { Authorization: STRAPI_TOKEN, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body?.error || "")}`);
  return body;
}

const post = (path, data) => strapi(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data }),
});

for (const c of CATEGORIES) {
  const existing = await strapi(`category7s?filters[slug][$eq]=${c.slug}&fields[0]=slug`);
  if (existing.data?.length) { console.log(`category ${c.slug}: exists, skip`); continue; }
  await post("category7s?status=published", c);
  console.log(`category ${c.slug}: created`);
}

for (const a of AUTHORS) {
  const existing = await strapi(`author7s?filters[slug][$eq]=${a.slug}&fields[0]=slug`);
  if (existing.data?.length) { console.log(`author ${a.slug}: exists, skip`); continue; }
  const avatarPrompt =
    `${a.avatarScene}. Square headshot crop, premium magazine contributor-photo quality, photorealistic. ` +
    `Absolutely NO text, words, letters, logos or watermarks.`;
  const avatarId = await geminiImage(avatarPrompt, `mklearn-avatar-${a.slug}`);
  await post("author7s?status=published", {
    name: a.name,
    slug: a.slug,
    role: a.role,
    bio: [{ type: "paragraph", children: [{ type: "text", text: a.bioText }] }],
    ...(avatarId ? { avatar: avatarId } : {}),
  });
  console.log(`author ${a.slug}: created (avatar ${avatarId ? "#" + avatarId : "NONE"})`);
}

console.log("seed done");
