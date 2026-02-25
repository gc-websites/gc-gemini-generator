import { GoogleAdsApi, enums } from 'google-ads-api';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID;
const CONVERSION_ACTION_ID = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID;

// Prevent initialization crash if keys are missing (useful for dry runs / setup phase)
let client = null;
let customer = null;

try {
  if (DEVELOPER_TOKEN && CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && CUSTOMER_ID) {
    client = new GoogleAdsApi({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      developer_token: DEVELOPER_TOKEN
    });

    customer = client.Customer({
      customer_id: CUSTOMER_ID.replace(/-/g, ''), // Ensure no hyphens
      refresh_token: REFRESH_TOKEN
    });
    console.log("✅ Google Ads API Client Initialized");
  } else {
    console.log("⚠️ Google Ads API Client NOT initialized. Missing .env variables.");
  }
} catch (err) {
  console.error("❌ Failed to initialize Google Ads API:", err.message);
}

/**
 * Sends a batch of purchases to Google Ads as Offline Conversions
 * @param {Array} purchases Array of purchase objects from Strapi
 * @returns {Array} sentGroups
 */
export const sendPurchasesToGoogleAdsAndMarkUsed = async (purchases) => {
  if (!customer) {
    console.error("❌ Cannot send to Google Ads: Client not initialized.");
    return [];
  }

  if (!CONVERSION_ACTION_ID) {
    console.error("❌ Cannot send to Google Ads: GOOGLE_ADS_CONVERSION_ACTION_ID is missing.");
    return [];
  }

  const sentGroups = [];
  const conversionActionResourceName = `customers/${CUSTOMER_ID.replace(/-/g, '')}/conversionActions/${CONVERSION_ACTION_ID}`;

  // Grouping by trackingId (similar to Facebook logic)
  const groups = purchases.reduce((acc, p) => {
    // Only process if it hasn't been used for Google AND has some GAds identifier
    if (p.isGoogleUsed === true) return acc;
    if (!p.gclid && !p.wbraid && !p.gbraid) return acc;

    const key = p.trackingId || "no-tracking";
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  for (const trackingId in groups) {
    const groupItems = groups[trackingId];
    const first = groupItems[0];
    const totalValue = groupItems.reduce((sum, p) => sum + (p.value || 0), 0);

    console.log(`➡️ Sending grouped purchase to Google Ads: trackingId=${trackingId}, items=${groupItems.length}, totalValue=${totalValue}`);

    try {
      const clickConversion = {
        conversion_action: conversionActionResourceName,
        conversion_date_time: formatEventTime(first.event_time) || formatEventTimeForNow(), // Format: yyyy-mm-dd hh:mm:ss+|-hh:mm
        conversion_value: Number(totalValue.toFixed(2)),
        currency_code: 'USD',
        order_id: first.order_id || crypto.randomUUID(), // Deduplication key
        custom_variables: [],
      };

      // Add the available identifier
      if (first.gclid) {
        clickConversion.gclid = first.gclid;
      } else if (first.wbraid) {
        clickConversion.wbraid = first.wbraid;
      } else if (first.gbraid) {
        clickConversion.gbraid = first.gbraid;
      }

      // 🔵 1. Send to Google Ads
      const response = await customer.conversionUploads.uploadClickConversions([
        clickConversion
      ], {
        partial_failure: true
      });

      let hasError = false;
      if (response && response.partial_failure_error) {
        console.error(`❌ Google Ads Partial Failure for group ${trackingId}:`, JSON.stringify(response.partial_failure_error, null, 2));
        hasError = true;
      }

      if (!hasError) {
        console.log(`✅ Google Ads accepted group ${trackingId}`);

        const sentItems = [];
        const STRAPI_API_URL = process.env.STRAPI_API_URL;
        const STRAPI_TOKEN = process.env.STRAPI_TOKEN;

        // 🟢 2. Update purchases in Strapi -> isGoogleUsed = true
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
                  isGoogleUsed: true // specific field for Google
                }
              })
            }
          );

          if (!updateRes.ok) {
            const text = await updateRes.text();
            console.error(`❌ Failed to update purchase ${purchase.id} for Google:`, text);
          } else {
            console.log(`🟢 Purchase ${purchase.id} marked as isGoogleUsed = true`);
            sentItems.push({
              id: purchase.id,
              asin: purchase.ASIN,
              trackingId: purchase.trackingId,
              value: purchase.value
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
      }

    } catch (err) {
      console.error(`🔥 Error processing Google Ads group ${trackingId}:`, err);
    }
  }

  return sentGroups;
};

// Helper: Google Ads API expects "yyyy-mm-dd hh:mm:ss+|-hh:mm"
function formatEventTime(unixTimestampStr) {
  if (!unixTimestampStr) return null;
  const date = new Date(Number(unixTimestampStr) * 1000);
  if (isNaN(date.getTime())) return null;

  return formatDateToGoogleAds(date);
}

function formatEventTimeForNow() {
  return formatDateToGoogleAds(new Date());
}

function formatDateToGoogleAds(date) {
  const pad = (n) => n < 10 ? '0' + n : n;
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  // Use +00:00 for UTC
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+00:00`;
}
