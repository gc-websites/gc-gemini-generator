import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const userDataDir = path.resolve(__dirname, "amazon-us-session");

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });
  const page = await context.newPage();

  try {
    console.log("Navigating to earnings...");
    await page.goto("https://affiliate-program.amazon.com/p/reporting/earnings", { waitUntil: "load" });

    console.log("Waiting for date range popover...");
    // Try to click date range display
    const dateRangeDisplay = page.locator("#ac-daterange-display-report-timeInterval");
    await dateRangeDisplay.waitFor({ state: "visible", timeout: 15000 });

    await wait(2000);
    await dateRangeDisplay.hover();
    await wait(500);
    await dateRangeDisplay.click({ force: true });
    console.log("Clicked date range display. Waiting for popover...");

    const popover = page.locator('div.a-popover[aria-hidden="false"]');
    await popover.waitFor({ state: "visible", timeout: 10000 });
    await wait(1000);

    // Choose "Today"
    console.log("Selecting 'Today'...");
    const last30Radio = popover.locator('input[type="radio"][value="today"]');
    await last30Radio.click({ force: true });

    await wait(1000);
    console.log("Clicking apply...");
    await popover.locator('.a-button-primary').first().click({ force: true }).catch(() => { });
    await popover.locator('.a-button-text:has-text("Apply")').first().click({ force: true }).catch(() => { });

    console.log("Waiting for spinner to hide...");
    const spinner = page.locator(".a-dtt-spinner");
    try {
      await spinner.waitFor({ state: "hidden", timeout: 15000 });
    } catch (_) { }

    await wait(15000); // Give it a fixed 15s to render the table

    const data = await page.evaluate(() => {
      const jsonSummary = Array.from(document.querySelectorAll("#ac-report-earning-summary-tbl tbody.a-dtt-tbody tr")).map(row => {
        const cells = row.querySelectorAll("td");
        return {
          c0: cells[0]?.textContent?.trim(),
          c0_url: cells[0]?.querySelector("a")?.getAttribute("href"),
          c1: cells[1]?.textContent?.trim(),
          c2: cells[2]?.textContent?.trim(),
          c3: cells[3]?.textContent?.trim(),
          c4: cells[4]?.textContent?.trim(),
          c5: cells[5]?.textContent?.trim()
        }
      });

      return { jsonSummary };
    });

    fs.writeFileSync('amazon_rows.json', JSON.stringify(data.jsonSummary, null, 2));
    console.log("Wrote amazon_rows.json");

  } catch (e) {
    console.error(e);
  } finally {
    await context.close();
  }
}
run();
