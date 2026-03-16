import { createTagCA } from "./playwright/createTagsCA.js";
import { createTagUS } from "./playwright/createTagsUS.js";
import { createTagES } from "./playwright/createTagsES.js";
import dotenv from 'dotenv';

dotenv.config();


const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;


export const tagCreator = async (country) => {
  try {
    let amznRes;
    if (country === 'USA') {
      amznRes = await createTagUS();
      if (amznRes.ok) {
        const data = {
          name: amznRes.tag,
          isUsed: false
        }
        const strapiRes = await fetch(`${STRAPI_API_URL}/api/taguses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: STRAPI_TOKEN,
          },
          body: JSON.stringify({ data: data }),
        })
        if (!strapiRes.ok) {
          const err = await strapiRes.text()
          throw new Error(err)
        }
        console.log(data);
        return data;
      }
    }
    else if (country === 'Canada') {
      amznRes = await createTagCA();
      if (amznRes.ok) {
        const data = {
          name: amznRes.tag,
          isUsed: false
        }
        const strapiRes = await fetch(`${STRAPI_API_URL}/api/tagcas`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: STRAPI_TOKEN,
          },
          body: JSON.stringify({ data: data }),
        })
        if (!strapiRes.ok) {
          const err = await strapiRes.text()
          throw new Error(err)
        }
        console.log(data);
        return data;
      }
    }
    else if (country === 'Spain') {
      amznRes = await createTagES();
      if (amznRes.ok) {
        const data = {
          name: amznRes.tag,
          isUsed: false
        }
        // Endpoint for "Tages" will depend on Strapi pluralization.
        // It is /api/tageses.
        const strapiRes = await fetch(`${STRAPI_API_URL}/api/tageses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: STRAPI_TOKEN,
          },
          body: JSON.stringify({ data: data }),
        })
        if (!strapiRes.ok) {
          const err = await strapiRes.text()
          throw new Error(err)
        }
        console.log(data);
        return data;
      } else {
        throw new Error(amznRes.message || "Failed to create ES tag");
      }
    }
  } catch (err) {
    console.error('❌ Create-tag error:', err)
    return err.message;
  }
}