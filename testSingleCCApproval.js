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
    throw new Error(`Failed to fetch purchase: ${res.statusText}`);
  }

  const data = await res.json();
  return data.data;
}

async function testSingleCCApprovalTest() {
  try {
    const documentId = 'sspu5x4epz437istcphxbo8v';
    console.log(`🔍 Fetching purchase with ID: ${documentId} from Strapi...`);
    const purchase = await getPurchaseById(documentId);

    if (!purchase) {
      console.log("❌ Purchase not found!");
      return;
    }

    console.log(`✅ Found purchase. ASIN: ${purchase.asin}, Tracking ID: ${purchase.trackingId}`);

    // runAmazonCCApproval expects an array of purchases
    const purchasesArray = [purchase];

    console.log("🔄 Running Amazon CC Approval...");
    const approvedPurchases = await runAmazonCCApproval(purchasesArray);

    console.log("✅ Approval finished.");
    console.log("📊 Resulting CC data for purchase:");
    console.log(JSON.stringify({
      CCChecked: approvedPurchases[0].CCChecked,
      isCCCommission: approvedPurchases[0].isCCCommission,
      ccRate: approvedPurchases[0].ccRate,
      value: approvedPurchases[0].value
    }, null, 2));

  } catch (e) {
    console.error("❌ Error:", e);
  } finally {
    process.exit(0);
  }
}

testSingleCCApprovalTest();
