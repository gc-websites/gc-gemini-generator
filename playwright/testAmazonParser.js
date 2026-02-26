import { ParseAmazonOrders } from "./getEarningsData.js";

async function run() {
  try {
    console.log("Testing new Parser...");
    const orders = await ParseAmazonOrders();
    console.log("Success! Orders count:", orders ? orders.length : 0);
  } catch (e) {
    console.error("Failed", e);
  }
}

run();
