import dotenv from 'dotenv';
import crypto from "crypto";

dotenv.config();

const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_EVENTS_URL =
  `https://graph.facebook.com/v24.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;

const getLeadsFromStrapi = async () => {
  try {
    const dateFrom = new Date(
      Date.now() - 47 * 60 * 60 * 1000
    ).toISOString();

    const pageSize = 100;
    let page = 1;
    let pageCount = 1;

    const allLeads = [];
    const seenTrackingIds = new Set(); // 👈 важно

    while (page <= pageCount) {
      const url =
        `${STRAPI_API_URL}/api/leads` +
        `?filters[createdAt][$gte]=${encodeURIComponent(dateFrom)}` +
        `&pagination[page]=${page}` +
        `&pagination[pageSize]=${pageSize}` +
        `&sort[0]=createdAt:desc`;

      const res = await fetch(url, {
        headers: {
          Authorization: STRAPI_TOKEN,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        throw new Error(`Strapi error ${res.status}`);
      }

      const json = await res.json();

      for (const lead of json.data) {
        const trackingId = lead.trackingId;

        // ⛔ пропускаем лиды без trackingId
        if (!trackingId) continue;

        // ⛔ если уже был — пропускаем
        if (seenTrackingIds.has(trackingId)) continue;

        // ✅ первый (самый новый) сохраняем
        seenTrackingIds.add(trackingId);
        allLeads.push(lead);
      }

      pageCount = json.meta.pagination.pageCount;
      page++;

      // ⏳ маленькая пауза
      await new Promise((r) => setTimeout(r, 150));
    }

    return allLeads;
  } catch (e) {
    console.error("❌ getLeadsFromStrapi error:", e);
    return [];
  }
};

const getAmznComissionsFromStrapi = async () => {
  try {
    const url =
      `${STRAPI_API_URL}/api/amzn-comissions` +
      `?pagination[pageSize]=100`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: STRAPI_TOKEN,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`Strapi error ${res.status}`);
    }

    const json = await res.json();

    // Strapi v4 → данные всегда в data
    return json.data;
  } catch (e) {
    console.error("❌ getAmznComissionsFromStrapi error:", e);
    return [];
  }
};




const normalizeTrackingId = (trackingId) => {
  if (!trackingId) return null;
  return trackingId.replace(/-20$/, "");
};

const attachOrdersToLeads = (orders, leads) => {
  if (!Array.isArray(orders) || !Array.isArray(leads)) {
    throw new Error("orders и leads должны быть массивами");
  }

  // 1️⃣ Группируем ВСЕ заказы по trackingId
  const ordersByTrackingId = orders.reduce((acc, order) => {
    const key = normalizeTrackingId(order.trackingId);
    if (!key) return acc;

    if (!acc[key]) acc[key] = [];
    acc[key].push(order); // кладём ВЕСЬ заказ

    return acc;
  }, {});

  // 2️⃣ Берём ТОЛЬКО те лиды, у которых есть заказы
  return leads
    .map((lead) => {
      const key = normalizeTrackingId(lead.trackingId);
      const matchedOrders = key ? ordersByTrackingId[key] : null;

      if (!matchedOrders || matchedOrders.length === 0) return null;

      return {
        ...lead,
        orders: matchedOrders
      };
    })
    .filter(Boolean); // ❌ убираем лиды без заказов
};

const createPurchasesToStrapi = (matchedLeads) => {
  if (!Array.isArray(matchedLeads)) {
    throw new Error("matchedLeads должен быть массивом");
  }

  const purchases = [];

  for (const lead of matchedLeads) {
    const {
      productId,
      clickDate,
      fbp,
      fbc,
      trackingId: leadTrackingId,
      client_user_agent,
      client_ip_address,
      action_source,
      external_id,
      campaign_id
    } = lead;

    if (!Array.isArray(lead.orders)) continue;

    for (const order of lead.orders) {

      const currentEventTime = String(Math.floor(Date.now() / 1000)); // ✅ новое время

      purchases.push({
        // 🔹 данные лида
        productId,
        clickDate,
        fbp,
        fbc,
        trackingId: leadTrackingId,
        client_user_agent,
        client_ip_address,
        external_id,
        gclid: lead.gclid,
        wbraid: lead.wbraid,
        gbraid: lead.gbraid,
        campaign_id: campaign_id || null,

        event_name: "Purchase",
        event_time: currentEventTime, // ✅ теперь новое время
        event_id: crypto.randomUUID(),
        order_id: crypto.randomUUID(),

        value: order.price * order.orderedCount,

        event_source_url: (lead.event_source_url || `https://nice-advice.info/product/${productId}`).substring(0, 254),
        action_source: action_source || "website",
        isUsed: false,

        // 🔹 данные заказа
        title: order.title ? order.title.substring(0, 254) : null,
        itemUrl: order.itemUrl ? order.itemUrl.substring(0, 254) : null,
        ASIN: order.ASIN,
        category: order.category,
        merchant: order.merchant,
        orderedCount: order.orderedCount,
        trackingId: order.trackingId,
        price: order.price
      });
    }
  }

  return purchases;
};



const applyCommissionsToPurchases = (purchases, commissions) => {
  if (!Array.isArray(purchases) || !Array.isArray(commissions)) {
    throw new Error("purchases и commissions должны быть массивами");
  }

  const DEFAULT_COMMISSION = 4;

  // 1️⃣ category → commission
  const commissionMap = commissions.reduce((acc, item) => {
    if (!item.category || typeof item.commision !== "number") return acc;

    acc[item.category.trim()] = item.commision;
    return acc;
  }, {});

  // 2️⃣ применяем комиссию
  return purchases.map((purchase) => {
    const category = purchase.category?.trim();

    const commission =
      commissionMap[category] ?? DEFAULT_COMMISSION;

    const newValue =
      typeof purchase.value === "number"
        ? Number(((purchase.value * commission) / 100).toFixed(2))
        : 0;

    return {
      ...purchase,
      commission, // 👈 явно видно какая комиссия применена
      value: newValue
    };
  });
};

const postPurchasesToStrapi = async (purchases) => {
  try {
    for (const purchase of purchases) {
      const res = await fetch(`${STRAPI_API_URL}/api/purchases`, {
        method: "POST",
        headers: {
          Authorization: STRAPI_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          data: purchase
        })
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("❌ Strapi 500 payload:", JSON.stringify(purchase, null, 2));
        throw new Error(`Strapi error ${res.status}: ${text}`);
      }

      const json = await res.json();
      console.log("✅ Purchase saved:", json.data?.id);
    }
  } catch (e) {
    console.error("❌ postPurchasesToStrapi error:", e);
  }
};

const getPurchasesFromStrapiLast24h = async () => {
  try {
    const dateFrom = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();

    const pageSize = 100;
    let page = 1;
    let pageCount = 1;
    const allPurchases = [];

    while (page <= pageCount) {
      const url =
        `${STRAPI_API_URL}/api/purchases` +
        `?filters[createdAt][$gte]=${encodeURIComponent(dateFrom)}` +
        `&pagination[page]=${page}` +
        `&pagination[pageSize]=${pageSize}` +
        `&sort[0]=createdAt:desc`;

      const res = await fetch(url, {
        headers: {
          Authorization: STRAPI_TOKEN,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Strapi error ${res.status}: ${text}`);
      }

      const json = await res.json();

      allPurchases.push(...json.data);

      pageCount = json.meta.pagination.pageCount;
      page++;
    }

    return allPurchases;
  } catch (e) {
    console.error("❌ getPurchasesFromStrapiLast24h error:", e);
    return [];
  }
};

const filterNewPurchases = (amazonOrders, strapiPurchases) => {
  const newOrders = [];

  // Calculate the total ordered count we ALREADY have in Strapi for each trackingId+ASIN
  const strapiSums = {};
  for (const p of strapiPurchases) {
    const key = `${p.trackingId}_${p.ASIN}`;
    if (!strapiSums[key]) strapiSums[key] = 0;
    strapiSums[key] += (p.orderedCount || 1);
  }

  for (const amazonOrder of amazonOrders) {
    const key = `${amazonOrder.trackingId}_${amazonOrder.ASIN}`;
    const strapiCount = strapiSums[key] || 0;

    // If Amazon reports more orders than we have saved in Strapi,
    // we need to save the difference.
    if (amazonOrder.orderedCount > strapiCount) {
      const difference = amazonOrder.orderedCount - strapiCount;
      newOrders.push({
        ...amazonOrder,
        orderedCount: difference
      });
      // Update our local sum so we don't count it again if amazonOrders contains duplicates
      strapiSums[key] += difference;
    }
  }

  return newOrders;
};

const getUnusedPurchasesFromStrapi = async () => {
  try {
    const pageSize = 100;
    let page = 1;
    let pageCount = 1;

    const allPurchases = [];

    while (page <= pageCount) {
      const url =
        `${STRAPI_API_URL}/api/purchases` +
        `?filters[isUsed][$eq]=false` +
        `&pagination[page]=${page}` +
        `&pagination[pageSize]=${pageSize}` +
        `&sort[0]=createdAt:asc`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: STRAPI_TOKEN,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Strapi error ${res.status}: ${text}`);
      }

      const json = await res.json();

      allPurchases.push(...json.data);

      pageCount = json.meta.pagination.pageCount;
      page++;
    }

    console.log(
      `📦 Unused purchases loaded: ${allPurchases.length}`
    );

    return allPurchases;
  } catch (e) {
    console.error("❌ getUnusedPurchasesFromStrapi error:", e);
    return [];
  }
};


const sendLeadToFacebook = async (lead) => {
  console.log("➡️ Sending lead to Facebook:", {
    productId: lead.productId,
    trackingId: lead.trackingId
  });

  const fbPayload = {
    data: [
      {
        event_name: "Lead",
        event_time: Number(lead.event_time),
        action_source: "website",
        event_source_url: lead.event_source_url || "https://nice-advice.info",
        event_id: lead.event_id,
        user_data: {
          fbc: lead.fbc,
          fbp: lead.fbp,
          client_user_agent: lead.client_user_agent,
          client_ip_address: lead.client_ip_address,
          external_id: lead.external_id
        },
        custom_data: {
          content_ids: [lead.productId],
          content_type: "product"
        }
      }
    ]
  };

  try {
    const fbRes = await fetch(FB_EVENTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(fbPayload)
    });

    const fbText = await fbRes.text();
    if (!fbRes.ok) {
      console.error("❌ Facebook Lead error:", fbText);
    } else {
      console.log("✅ Facebook Lead accepted:", fbText);
    }
  } catch (err) {
    console.error("🔥 Error sending lead to Facebook:", err);
  }
};


const sendPurchasesToFacebookAndMarkUsed = async (purchases) => {
  const sentGroups = [];

  // 1️⃣ Grouping by trackingId
  const groups = purchases.reduce((acc, p) => {
    const key = p.trackingId || "no-tracking";
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  for (const trackingId in groups) {
    const groupItems = groups[trackingId];
    // Since all items in a group share the same lead/user data, we use the first one for common fields
    const first = groupItems[0];

    // Calculate total value and construct contents array
    const totalValue = groupItems.reduce((sum, p) => sum + (p.value || 0), 0);
    const contents = groupItems.map(p => ({
      id: p.ASIN,
      quantity: p.orderedCount,
      item_price: p.price
    }));

    console.log(`➡️ Sending grouped purchase to Facebook: trackingId=${trackingId}, items=${groupItems.length}, totalValue=${totalValue}`);

    const fbPayload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Number(first.event_time),
          action_source: first.action_source || "website",
          event_source_url: first.event_source_url,
          event_id: crypto.randomUUID(), // New unique ID for the grouped event

          user_data: {
            fbc: first.fbc,
            fbp: first.fbp,
            client_user_agent: first.client_user_agent,
            client_ip_address: first.client_ip_address,
            external_id: first.external_id
          },

          custom_data: {
            currency: "USD",
            value: Number(totalValue.toFixed(2)),
            order_id: first.order_id, // Use the first order's ID as reference
            contents: contents
          }
        }
      ]
    };

    try {
      // 🔵 1. Отправка в Facebook
      const fbRes = await fetch(FB_EVENTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fbPayload)
      });

      const fbText = await fbRes.text();
      let fbResponseData = {};
      try {
        fbResponseData = JSON.parse(fbText);
      } catch (e) {
        console.warn("⚠️ Failed to parse FB response JSON:", fbText);
      }

      if (!fbRes.ok) {
        console.error(`❌ Facebook error for group ${trackingId}:`, fbText);
        continue;
      }

      console.log(`✅ Facebook accepted group ${trackingId}:`, fbText);

      const { fbtrace_id, messages, events_received } = fbResponseData;

      const sentItems = [];
      // 🟢 2. Обновляем все покупки в группе → isUsed = true + логи FB
      for (const purchase of groupItems) {
        const updateRes = await fetch(
          `${STRAPI_API_URL}/api/purchases/${purchase.documentId}`,
          {
            method: "PUT",
            headers: {
              Authorization: STRAPI_TOKEN,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              data: {
                isUsed: true,
                fbtrace_id: fbtrace_id || null,
                events_received: events_received !== undefined ? String(events_received) : null,
                messages: messages ? JSON.stringify(messages) : null
              }
            })
          }
        );

        if (!updateRes.ok) {
          const text = await updateRes.text();
          console.error(`❌ Failed to update purchase ${purchase.id}:`, text);
        } else {
          console.log(
            `🔄 Creating Purchase in Strapi for Lead ${purchase.trackingId} (Order: ${purchase.documentId})`
          );

          // Include Google Ads parameters if they exist on the lead
          const purchaseData = {
            documentId: purchase.documentId,
            trackingId: purchase.trackingId,
            productId: purchase.productId,
            ASIN: purchase.ASIN,
            fbp: purchase.fbp || "",
            fbc: purchase.fbc || "",
            client_ip_address: purchase.client_ip_address || "",
            client_user_agent: purchase.client_user_agent || "",
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000).toString(),
            event_source_url: purchase.event_source_url || "",
            action_source: "website",
            isUsed: true, // This should be true as it's an update after sending to FB
            isGoogleUsed: false,
            value: purchase.value,
            currency: "USD",
            gclid: purchase.gclid || null,
            wbraid: purchase.wbraid || null,
            gbraid: purchase.gbraid || null
          };
          // The provided snippet seems to be for *creating* a purchase, but it's placed in an *update* block.
          // Assuming the intent was to ensure these fields are present when a purchase is marked as used,
          // and that `purchase` object already contains these fields from its initial creation.
          // If this block is truly for *creating* a new purchase, it should be in a different function.
          // For now, I'm placing it as requested, but adapting `leadData` to `purchase` as it's in the context of `for (const purchase of groupItems)`.

          console.log(`🟢 Purchase ${purchase.id} marked as isUsed = true`);
          sentItems.push({
            id: purchase.id,
            asin: purchase.ASIN,
            trackingId: purchase.trackingId,
            value: purchase.value,
            title: purchase.title,
            commission: purchase.commission,
            orderedCount: purchase.orderedCount,
            price: purchase.price,
            category: purchase.category,
            ccRate: purchase.ccRate
          });
        }
      }

      if (sentItems.length > 0) {
        sentGroups.push({
          trackingId,
          items: sentItems,
          totalValue: Number(totalValue.toFixed(2))
        });
      }
    } catch (err) {
      console.error(`🔥 Error processing group ${trackingId}:`, err);
    }
  }

  return sentGroups;
};

export { getLeadsFromStrapi, attachOrdersToLeads, createPurchasesToStrapi, getAmznComissionsFromStrapi, applyCommissionsToPurchases, postPurchasesToStrapi, getPurchasesFromStrapiLast24h, filterNewPurchases, getUnusedPurchasesFromStrapi, sendPurchasesToFacebookAndMarkUsed, sendLeadToFacebook };
