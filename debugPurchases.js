import { ParseAmazonOrders } from './playwright/getEarningsData.js';
import { attachOrdersToLeads, createPurchasesToStrapi, getLeadsFromStrapi } from './functionsForTracking.js';
import fs from 'fs';

async function debug() {
  const ordersFromAmazon = await ParseAmazonOrders();
  const leadsFromStrapi = await getLeadsFromStrapi();
  const matchedLeads = await attachOrdersToLeads(ordersFromAmazon, leadsFromStrapi);
  const createdPurchasesForStrapi = await createPurchasesToStrapi(matchedLeads);

  fs.writeFileSync('debug_purchases.json', JSON.stringify(createdPurchasesForStrapi, null, 2));
  console.log("Dumped", createdPurchasesForStrapi.length, "purchases to debug_purchases.json");
}

debug();
