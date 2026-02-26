import dotenv from 'dotenv';
dotenv.config();

const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;
import crypto from 'crypto';

async function testPost() {
  const dummyPayload = {
    productId: "dummy123",
    trackingId: "subtag-dummy",
    event_name: "Purchase",
    event_time: "12345678",
    event_id: crypto.randomUUID(),
    order_id: crypto.randomUUID(),
    value: 5,
    event_source_url: "http",
    action_source: "website",
    isUsed: false,
    title: "Test",
    itemUrl: "http",
    ASIN: "dummy",
    category: "Health",
    merchant: "Amz",
    orderedCount: 1,
    price: 5
  };

  const res = await fetch(`${STRAPI_API_URL}/api/purchases`, {
    method: "POST",
    headers: {
      Authorization: STRAPI_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: dummyPayload })
  });

  if (!res.ok) {
    console.error("FAIL", await res.text());
  } else {
    console.log("SUCCESS", (await res.json()).data.id);
  }
}

testPost();
