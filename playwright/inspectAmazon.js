import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const userDataDir = path.resolve(__dirname, "amazon-us-session");

async function run() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });
  const page = await context.newPage();

  try {
    console.log("Navigating to earnings...");
    await page.goto("https://affiliate-program.amazon.com/p/reporting/earnings", { waitUntil: "load" });

    let currentUrl = page.url();
    if (currentUrl.includes("signin")) {
      console.log("Filling credentials...");

      await page.waitForSelector("#ap_email", { timeout: 10000 }).catch(() => null);
      if (await page.locator("#ap_email").isVisible()) {
        await page.fill("#ap_email", "dk@globecoders.net");
        await page.click("#continue");
      }

      await page.waitForSelector("#ap_password", { timeout: 10000 }).catch(() => null);
      if (await page.locator("#ap_password").isVisible()) {
        await page.fill("#ap_password", "CIBu7yd2g863e@$2ed23");
        await page.click("#signInSubmit");
      }

      console.log("Please solve CAPTCHA/OTP if prompted. Waiting to redirect to earnings...");
    }

    await page.waitForURL((url) => {
      return url.toString().includes("/p/reporting/earnings") || url.toString().includes("/home");
    }, { timeout: 0 });

    if (page.url().includes("/home")) {
      console.log("Redirected to home, navigating back to earnings...");
      await page.goto("https://affiliate-program.amazon.com/p/reporting/earnings", { waitUntil: "load" });
    }

    console.log("We are on earnings page. Waiting 15 seconds for React to render tables...");
    await new Promise(r => setTimeout(r, 15000));

    console.log("Dumping HTML...");
    const data = await page.evaluate(() => {
      const dtt = document.querySelector("#ac-report-earning-summary-tbl")?.outerHTML;
      const anyTable = document.querySelector("table")?.outerHTML;
      const mainContent = document.querySelector("#a-page")?.innerHTML || document.body.innerHTML;
      return { dtt, anyTable, mainContent };
    });

    if (data.dtt) fs.writeFileSync("amazon_dtt.html", data.dtt);
    if (data.anyTable) fs.writeFileSync("amazon_table.html", data.anyTable);
    fs.writeFileSync("amazon_body.html", data.mainContent);

    console.log("Dump successful!");

  } catch (e) {
    console.error(e);
  } finally {
    await context.close();
  }
}
run();
