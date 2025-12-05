import crypto from "crypto";
import fs from "fs";
import csv from "csv-parser";
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';

dotenv.config();

const PIXEL_ID = process.env.PIXEL_ID;
const PIXEL_TOKEN = process.env.PIXEL_TOKEN ;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

function readCSV() {
  return new Promise((resolve, reject) => {
    const results = [];
    let isFirstLine = true;

    fs.createReadStream("./downloads/1761092641264-Fee-Earnings-93bfcf92-0353-41b8-b946-3da94c975d78-CSV.csv")
      .pipe(
        csv({
          mapHeaders: ({ header, index }) => {
            if (isFirstLine && index === 0) {
              isFirstLine = false;
              return null; // пропускаем первую "шапку"
            }

            // задаем свои заголовки
            const headers = [
              "Category",
              "Name",
              "ASIN",
              "Seller",
              "TrackingID",
              "DateShipped",
              "Price",
              "ItemsShipped",
              "Returns",
              "Revenue",
              "AdFees",
              "DeviceType",
            ];
            return headers[index];
          },
          skipLines: 1, // пропускаем первую строку с метаданными
        })
      )
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

// function createLead(fbclid, productId){
//   const timestamp = new Date().toISOString();
//   const lead = {
//     fbclid: fbclid,
//     clickId: nanoid(),
//     productId: productId,
//     date: `${timestamp}`
//   }
//   return lead;
// }

// async function strapiLeadPost(lead){
//   try {
//         const strapiRes = await fetch(`https://vivid-triumph-4386b82e17.strapiapp.com/api/leads`, {
//           method: 'POST',
//           headers: {
//             'Content-Type': 'application/json',
//             Authorization: 'Bearer e978fa4adf9de867ba4e4995ea700b6c6a57a89292646fb190ff48d45e02b136dba85b0924b3e5648a5b7dcfcd6fbc671c0a141093752ae2d92beb420e0e9ef20dce76ea8185baf29592f0760cb2296e17c2c2f472907268b8b1a299c6a48bec94eb7ad62a6fd68992975babf3f81c14ee32efe761fc2400a27e847c49371ef5',
//           },
//           body: JSON.stringify({ data: lead }),
//         })
//         if (!strapiRes.ok) {
//           const err = await strapiRes.text()
//           throw new Error(err)
//         }
//         return true;
//       } catch (err) {
//         console.error('❌ Create-post error:', err)
//         return err.message;
//       }
// }

export { readCSV, hash, createLead, strapiLeadPost };