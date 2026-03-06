import dotenv from 'dotenv';
dotenv.config();

import { ParseAmazonOrders } from './playwright/getEarningsData.js';
import { applyCommissionsToPurchases, attachOrdersToLeads, createPurchasesToStrapi, filterNewPurchases, getAmznComissionsFromStrapi, getLeadsFromStrapi, getPurchasesFromStrapiLast24h, getUnusedPurchasesFromStrapi, postPurchasesToStrapi, sendPurchasesToFacebookAndMarkUsed } from './functionsForTracking.js';
import { runAmazonCCApproval } from './functionsForAmazonCC.js';

import { createTelegramBot } from "./tgBot.js";
const TG_TOKEN = process.env.TG_TOKEN;
const TG_BOT_ORDERS_ID = process.env.TG_BOT_ORDERS_ID;
const bot = createTelegramBot(TG_TOKEN);

async function processAmazonOrders() {
  console.log("🔄 Starting test for Amazon Orders Processing...");
  try {
    const ordersFromAmazon = await ParseAmazonOrders();
    const leadsFromStrapi = await getLeadsFromStrapi();
    const matchedLeads = await attachOrdersToLeads(ordersFromAmazon, leadsFromStrapi);
    const createdPurchasesForStrapi = await createPurchasesToStrapi(matchedLeads);
    const comissions = await getAmznComissionsFromStrapi();
    const purchasesToStrapi = await applyCommissionsToPurchases(createdPurchasesForStrapi, comissions);
    const purchasesLast24h = await getPurchasesFromStrapiLast24h();
    const newPurchases = await filterNewPurchases(purchasesToStrapi, purchasesLast24h);

    if (newPurchases.length > 0) {
      console.log(`📦 Found ${newPurchases.length} new purchases. Posting to Strapi...`);
      await postPurchasesToStrapi(newPurchases);
    } else {
      console.log(`📦 No new purchases found.`);
    }

    const unusedPurchases = await getUnusedPurchasesFromStrapi();
    console.log(`🔍 Found ${unusedPurchases.length} unused purchases for CC approval.`);
    const approvedPurchases = await runAmazonCCApproval(unusedPurchases);
    const sendedToFbGroups = await sendPurchasesToFacebookAndMarkUsed(approvedPurchases);

    for (const group of sendedToFbGroups) {
      const { trackingId, items, totalValue } = group;

      const message = items
        .map(p => `
  • ID: ${p.id}
    ASIN: ${p.asin}
    Tracking: ${p.trackingId}
    Price: ${p.price}$
    Commission: ${p.ccRate ? p.commission + '% + ' + p.ccRate : p.commission}%
    Ordered Count: ${p.orderedCount}
    Category: ${p.category}
    Value: ${p.value}$
    Title: ${p.title}
  `.trim())
        .join("\n\n");

      await bot.sendMessage(
        TG_BOT_ORDERS_ID,
        `⭐️⭐️⭐️ TEST SCRIPT: NEW ORDERS ⭐️⭐️⭐️

  New orders sent to Facebook (Group: ${trackingId})
  💰 Total Group Value: ${totalValue}$

  ${message}
  `
      );
    }
    console.log("✅ Finished test for Amazon Orders Processing.");
  } catch (err) {
    console.error("❌ Error in processAmazonOrders:", err);
  }
}

processAmazonOrders().then(() => process.exit(0));
