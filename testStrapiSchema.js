import dotenv from 'dotenv';
dotenv.config();

const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

async function checkSchema() {
  const url = `${STRAPI_API_URL}/api/purchases?pagination[pageSize]=1&sort[0]=createdAt:desc`;
  const res = await fetch(url, {
    headers: { Authorization: STRAPI_TOKEN }
  });
  const json = await res.json();
  console.log("Existing purchase fields:", Object.keys(json.data[0]));
  console.log("Existing purchase:", json.data[0]);
}

checkSchema();
