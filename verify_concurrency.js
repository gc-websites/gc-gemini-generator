import { claimTag } from './functionsForProducts.js';
import { Mutex } from 'async-mutex';

// This script is for manual run or CI to verify that claimTag respects concurrent requests when used with Mutex.
async function runTest() {
  const tagMutex = new Mutex();
  const country = 'USA';
  const trackingDocId = 'initial-tag-doc-id';

  console.log("🚀 Starting concurrency test...");

  // We simulate 5 concurrent requests hitting the /lead logic
  const tasks = Array.from({ length: 5 }).map(async (_, i) => {
    const release = await tagMutex.acquire();
    try {
      console.log(`Lock acquired by Task ${i}`);
      const result = await claimTag(trackingDocId, country);
      console.log(`Task ${i} result:`, result);
      return result;
    } finally {
      release();
      console.log(`Lock released by Task ${i}`);
    }
  });

  const results = await Promise.all(tasks);

  const names = results.map(r => r?.name);
  const uniqueNames = new Set(names);

  console.log("--- RESULTS ---");
  console.log("Returned tags:", names);

  if (uniqueNames.size === results.length) {
    console.log("✅ SUCCESS: All tags are unique!");
  } else {
    console.error("❌ FAILURE: Duplicate tags detected!");
  }
}

// Note: To run this, you'd need node-fetch and dotenv configured as in the main app.
// Since it depends on Strapi, the best verification is to watch the logs on a real run.
// runTest();
