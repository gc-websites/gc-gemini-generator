// Manual one-shot: generate + publish a single UX Dictionary article.
// Run: node --env-file=.env run-one-uxdictionary.mjs
import { generateAndPostUxdictionary } from "./functionsUxdictionary.js";

try {
  const id = await generateAndPostUxdictionary();
  console.log("OK, documentId:", id);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}
