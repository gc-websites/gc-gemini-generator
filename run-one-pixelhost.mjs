// Manual one-shot: generate + publish a single PixelHost article.
// Run: node --env-file=.env run-one-pixelhost.mjs
import { generateAndPostPixelHost } from "./functionsPixelHost.js";

try {
  const id = await generateAndPostPixelHost();
  console.log("OK, documentId:", id);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}
