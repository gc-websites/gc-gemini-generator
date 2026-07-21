// Manual one-shot: generate + publish a single MK Learn article.
// Run: node --env-file=.env run-one-mklearn.mjs
import { generateAndPostMklearn } from "./functionsMklearn.js";

try {
  const id = await generateAndPostMklearn();
  console.log("OK, documentId:", id);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}
