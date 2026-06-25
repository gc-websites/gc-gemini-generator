// Manual one-shot: generate + publish a single WP Crew article.
// Run: node --env-file=.env run-one-wpcrew.mjs
import { generateAndPostWpcrew } from "./functionsWpcrew.js";

try {
  const id = await generateAndPostWpcrew();
  console.log("OK, documentId:", id);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}
