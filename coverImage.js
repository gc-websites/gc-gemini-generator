/**
 * Shared AI cover-image generator for the three content-site generators
 * (PixelHost / WP Crew / UX Dictionary) and the backfill script.
 *
 * Product decision (2026-07-03): article covers are AI-GENERATED via the Gemini
 * API — NOT scraped from the web (Openverse). This removes the EC2 failure mode
 * where Openverse returned nothing / SVG-only for design queries, leaving daily
 * cron articles cover-less. Order is Gemini image model -> Imagen (:predict)
 * fallback; both authenticate with the same GEMINI_API_KEY. On-theme, premium,
 * and reliable from both the EC2 and a local IP.
 *
 * Imagen is primary because it renders native 16:9 covers that fit the sites'
 * landscape article cards / hero; gemini-2.5-flash-image (square 1024) is the
 * fallback. Both are AI generation via the same key — nothing is scraped.
 *
 * Env: GEMINI_API_KEY, STRAPI_API_URL, STRAPI_TOKEN (already includes "Bearer "),
 *      COVER_ORDER   (default "imagen,gemini"),
 *      IMG_MODEL     (default "gemini-2.5-flash-image"),
 *      IMAGEN_MODEL  (default "imagen-4.0-generate-001").
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const STRAPI_URL = (process.env.STRAPI_API_URL || "").replace(/\/+$/, "");
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || ""; // includes "Bearer "
const IMG_MODEL = process.env.IMG_MODEL || "gemini-2.5-flash-image";
const IMAGEN_MODEL = process.env.IMAGEN_MODEL || "imagen-4.0-generate-001";
const COVER_ORDER = (process.env.COVER_ORDER || "imagen,gemini")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Accept only raster formats next/image can render (JPEG/PNG/WebP/GIF).
export function isRaster(buf) {
  if (!buf || buf.length < 12) return false;
  const a = buf.toString("latin1", 0, 12);
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50) return true; // PNG
  if (a.startsWith("GIF8")) return true; // GIF
  if (a.startsWith("RIFF") && a.slice(8, 12) === "WEBP") return true; // WebP
  return false;
}

async function uploadBuffer(buf, mime, prefix) {
  const ct = (mime || "image/png").split(";")[0];
  const form = new FormData();
  form.append("files", new Blob([buf], { type: ct }), `${prefix}-cover.${ct.includes("png") ? "png" : "jpg"}`);
  const up = await fetch(`${STRAPI_URL}/api/upload`, { method: "POST", headers: { Authorization: STRAPI_TOKEN }, body: form });
  const ub = await up.json().catch(() => null);
  if (up.ok && ub?.[0]?.id) return ub[0].id;
  return null;
}

// Generate a cover with the Gemini image model and upload it to Strapi.
export async function geminiImage(prompt, prefix) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMG_MODEL}:generateContent?key=${GEMINI_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
        signal: AbortSignal.timeout(120000),
      });
      const body = await res.json().catch(() => null);
      const parts = body?.candidates?.[0]?.content?.parts || [];
      const inline = parts.find((p) => p.inlineData)?.inlineData;
      if (!inline?.data) { if (attempt === 1) return null; await sleep(2500); continue; }
      const buf = Buffer.from(inline.data, "base64");
      if (buf.length < 5000 || !isRaster(buf)) return null;
      return await uploadBuffer(buf, inline.mimeType || "image/png", prefix);
    } catch { if (attempt === 1) return null; await sleep(2500); }
  }
  return null;
}

// Generate a cover with Imagen (:predict endpoint) and upload it to Strapi.
export async function imagenImage(prompt, prefix) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${GEMINI_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "16:9" } }),
        signal: AbortSignal.timeout(120000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`imagen ${res.status}`);
      const pred = body?.predictions?.[0];
      const b64 = pred?.bytesBase64Encoded;
      if (!b64) return null; // safety-filtered / empty
      const buf = Buffer.from(b64, "base64");
      if (buf.length < 5000 || !isRaster(buf)) return null;
      return await uploadBuffer(buf, pred.mimeType || "image/png", prefix);
    } catch {
      if (attempt === 2) return null;
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

// Wrap a concrete per-article scene in a shared quality + no-text envelope.
export function buildCoverPrompt(scene) {
  const s = (scene && String(scene).trim().length > 20) ? String(scene).trim() : "A clean, modern editorial cover scene";
  return (
    `${s} ` +
    `Wide 16:9 hero composition, high-end professional magazine-cover quality, sharp focus, beautiful natural lighting, ` +
    `cohesive limited color palette, rich realistic detail, depth and atmosphere, visually striking yet tasteful and uncluttered. ` +
    `Absolutely NO text, words, letters, numbers, captions, logos, watermarks, UI screenshots or labelled charts anywhere in the image.`
  );
}

/**
 * Generate an AI cover for one article and return { id, src }.
 * `scene` is a concrete cover description (e.g. Gemini's imagePrompt); `prefix`
 * seeds the uploaded filename. Tries COVER_ORDER (default gemini -> imagen).
 */
export async function generateCover({ scene, prefix, order = COVER_ORDER }) {
  const prompt = buildCoverPrompt(scene);
  for (const src of order) {
    let id = null;
    if (src === "gemini") id = await geminiImage(prompt, prefix);
    else if (src === "imagen") id = await imagenImage(prompt, prefix);
    if (id) return { id, src };
  }
  return { id: null, src: "none" };
}
