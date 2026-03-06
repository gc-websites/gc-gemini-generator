import dotenv from 'dotenv';
dotenv.config();

import { runAmazonCCApproval } from './functionsForAmazonCC.js';

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;

async function getPurchaseById(documentId) {
  const res = await fetch(`${STRAPI_API_URL}/api/purchases/${documentId}?populate=*`, {
    headers: {
      Authorization: STRAPI_TOKEN,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch purchase with ID ${documentId}: ${res.statusText}`);
  }

  const data = await res.json();
  return data.data;
}

async function testBatchCCApproval() {
  try {
    const documentIds = ['qyce0z2cv5t2hd6xjjcf3mr6', 'sspu5x4epz437istcphxbo8v', 'bvvjc7vog5auqyfga9ckqo2l'];
    console.log(`🔍 Fetching 3 purchases from Strapi...`);

    const purchasesArray = [];
    for (const id of documentIds) {
      const purchase = await getPurchaseById(id);
      if (purchase) {
        purchasesArray.push(purchase);
        console.log(`✅ Found purchase. ASIN: ${purchase.asin}, Tracking ID: ${purchase.trackingId}`);
      } else {
        console.log(`❌ Purchase not found for ID: ${id}`);
      }
    }

    if (purchasesArray.length === 0) {
      console.log("❌ No purchases found! Exiting.");
      return;
    }

    console.log(`🔄 Running Amazon CC Approval for ${purchasesArray.length} purchases...`);
    const approvedPurchases = await runAmazonCCApproval(purchasesArray);

    console.log("✅ Approval process finished.");
    console.log("📊 Resulting CC data for processed purchases:");

    const results = approvedPurchases.map(p => ({
      id: p.documentId,
      asin: p.asin,
      CCChecked: p.CCChecked,
      isCCCommission: p.isCCCommission,
      ccRate: p.ccRate,
      value: p.value
    }));

    console.table(results);

  } catch (e) {
    console.error("❌ Error:", e);
  } finally {
    process.exit(0);
  }
}

testBatchCCApproval();
