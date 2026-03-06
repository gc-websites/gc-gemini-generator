import dotenv from 'dotenv';
dotenv.config();

import { ParseAmazonOrders } from './playwright/getEarningsData.js';
import { applyCommissionsToPurchases, attachOrdersToLeads, createPurchasesToStrapi, filterNewPurchases, getAmznComissionsFromStrapi, getLeadsFromStrapi, getPurchasesFromStrapiLast24h, getUnusedPurchasesFromStrapi, postPurchasesToStrapi, sendPurchasesToFacebookAndMarkUsed } from './functionsForTracking.js';
import { runAmazonCCApproval } from './functionsForAmazonCC.js';
import { createTelegramBot } from "./tgBot.js";

const TG_TOKEN = process.env.TG_TOKEN;
const TG_BOT_ORDERS_ID = process.env.TG_BOT_ORDERS_ID;

const bot = createTelegramBot(TG_TOKEN);

async function processAmazonOrdersFullTest() {
  console.log("🔄 Starting full Amazon Orders Processing test...");
  try {
    const ordersFromAmazon = await ParseAmazonOrders();
    console.log(`📦 Parsed ${ordersFromAmazon.length} orders from Amazon.`);

    const leadsFromStrapi = await getLeadsFromStrapi();
    console.log(`🔍 Fetched ${leadsFromStrapi.length} leads from Strapi.`);

    const matchedLeads = await attachOrdersToLeads(ordersFromAmazon, leadsFromStrapi);
    console.log(`🔗 Matched ${matchedLeads.length} leads with orders.`);

    const createdPurchasesForStrapi = await createPurchasesToStrapi(matchedLeads);

    const comissions = await getAmznComissionsFromStrapi();
    const purchasesToStrapi = await applyCommissionsToPurchases(createdPurchasesForStrapi, comissions);

    const purchasesLast24h = await getPurchasesFromStrapiLast24h();
    const newPurchases = await filterNewPurchases(purchasesToStrapi, purchasesLast24h);
    console.log(`🆕 Found ${newPurchases.length} new purchases to post to Strapi.`);

    if (newPurchases.length > 0) {
      await postPurchasesToStrapi(newPurchases);
      console.log(`✅ Posted ${newPurchases.length} new purchases to Strapi.`);
    }

    const unusedPurchases = await getUnusedPurchasesFromStrapi();
    console.log(`⏳ Found ${unusedPurchases.length} unused purchases for CC approval.`);

    const approvedPurchases = await runAmazonCCApproval(unusedPurchases);
    console.log(`✔️ Approved ${approvedPurchases.length} purchases in Amazon CC.`);

    const sendedToFbGroups = await sendPurchasesToFacebookAndMarkUsed(approvedPurchases);
    console.log(`📤 Sent purchases to ${sendedToFbGroups.length} Facebook groups.`);

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
        `⭐️⭐️⭐️ TEST: NEW ORDERS ⭐️⭐️⭐️

  New orders sent to Facebook (Group: ${trackingId})
  💰 Total Group Value: ${totalValue}$

  ${message}
  `
      );
      console.log(`📩 Sent Telegram message for group ${trackingId} to chat ${TG_BOT_ORDERS_ID}`);
    }
    console.log("✅ Finished full test for Amazon Orders Processing.");
  } catch (err) {
    console.error("❌ Error in processAmazonOrdersFullTest:", err);
  } finally {
    process.exit(0);
  }
}

processAmazonOrdersFullTest();
