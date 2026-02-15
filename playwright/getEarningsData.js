import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   PATH FIX (ВАЖНО)
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 👉 Всегда используем сессию из playwright/amazon-us-session
const userDataDir = path.resolve(__dirname, "amazon-us-session");

/* =========================
   HELPERS
========================= */
const WAIT = 2000;

async function pause(label) {
  console.log(`⏳ ${label}`);
  await new Promise((res) => setTimeout(res, WAIT));
}

async function clickFirstVisible(locators, label) {
  for (const loc of locators) {
    try {
      await loc.waitFor({ state: "visible", timeout: 1500 });
      await pause(`Перед кликом: ${label}`);
      await loc.click({ force: true });
      console.log(`✅ Clicked: ${label}`);
      return true;
    } catch (_) {}
  }
  return false;
}

/* =========================
   PARSE TABLE FUNCTION
========================= */
async function parseOrdersFromCurrentPage(page) {
  const ordersContainer = page.locator("#ac-report-earning-summary-tbl");
  await ordersContainer.waitFor({ state: "visible", timeout: 20000 });

  const spinner = ordersContainer.locator(".a-dtt-spinner");
  try {
    await spinner.waitFor({ state: "hidden", timeout: 15000 });
  } catch (_) {}

  const ordersTable = ordersContainer
    .locator("table.a-dtt-table")
    .first();

  await ordersTable.waitFor({ state: "visible", timeout: 20000 });

  const orders = await ordersTable.evaluate((table) => {
    const rows = Array.from(
      table.querySelectorAll("tbody.a-dtt-tbody tr")
    );

    return rows.map((row) => {
      const cells = row.querySelectorAll("td");
      const titleCell = cells[0];
      const linkEl = titleCell.querySelector("a");

      const itemUrl = linkEl?.getAttribute("href") || null;

      // 🧩 ASIN из URL
      let ASIN = null;
      if (itemUrl) {
        const parts = itemUrl.split("/");
        ASIN = parts[parts.length - 1] || null;
      }

      // 💰 PRICE → number
      const rawPrice = cells[5]?.textContent?.trim() || null;
      let price = null;

      if (rawPrice) {
        const parsed = parseFloat(
          rawPrice.replace("$", "").replace(",", "")
        );
        price = isNaN(parsed) ? null : parsed;
      }

      // 🔢 ORDERED COUNT → number
      const rawOrderedCount = cells[3]?.textContent?.trim() || "0";
      const orderedCount = Number(rawOrderedCount) || 0;

      return {
        index:
          titleCell.querySelector(".item-id")?.textContent?.trim() || null,
        title: linkEl?.textContent?.trim() || null,
        itemUrl,
        ASIN,
        category: cells[1]?.textContent?.trim() || null,
        merchant: cells[2]?.textContent?.trim() || null,
        orderedCount,
        trackingId: cells[4]?.textContent?.trim() || null,
        price
      };
    });
  });

  console.log(`📦 Parsed ${orders.length} orders from current page`);

  return orders;
}

/* =========================
   MAIN FUNCTION
========================= */
export async function ParseAmazonOrders() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });

  const page = await context.newPage();

  try {
    // 1️⃣ Earnings
    await page.goto(
      "https://affiliate-program.amazon.com/p/reporting/earnings",
      { waitUntil: "load" }
    );

    console.log("📊 Earnings page loaded:", page.url());
    await pause("После загрузки страницы");

    // 2️⃣ Date Range
    const dateRangeDisplay =
      page.locator("#ac-daterange-display-report-timeInterval");

    await dateRangeDisplay.waitFor({ state: "visible", timeout: 15000 });

    await pause("Перед hover на Date Range");
    await dateRangeDisplay.hover();

    await pause("Перед click на Date Range");
    await dateRangeDisplay.click({ force: true });

    console.log("🖱️ Date range popover opened");

    const popover = page.locator('div.a-popover[aria-hidden="false"]');
    await popover.waitFor({ timeout: 10000 });
    await pause("Popover открыт");

    // 3️⃣ Today
    const todayRadio = popover.locator(
      'input[type="radio"][value="today"]'
    );

    await pause("Перед кликом Today");
    await todayRadio.click({ force: true });

    await page.waitForFunction(() => {
      const el = document.querySelector(
        'div.a-popover[aria-hidden="false"] input[type="radio"][value="today"]'
      );
      return !!el && el.checked === true;
    });

    console.log("📅 Today is checked");

    // 4️⃣ Apply
    const applyClicked = await clickFirstVisible(
      [
        popover.locator('.a-button.a-button-primary input.a-button-input'),
        popover.locator('.a-button.a-button-primary'),
        popover.locator('.a-button-primary .a-button-text:has-text("Apply")'),
        popover.getByText("Apply", { exact: true })
      ],
      "Apply"
    );

    if (!applyClicked) {
      throw new Error("❌ Не удалось кликнуть Apply");
    }

    await popover.waitFor({ state: "hidden", timeout: 15000 });
    console.log("✅ Popover closed → filter applied");

    /* =========================
       PAGE 1 PARSE
    ========================= */
    const page1Orders = await parseOrdersFromCurrentPage(page);

    let allOrders = [...page1Orders];

    /* =========================
       IF 25 → TRY PAGE 2
    ========================= */
    if (page1Orders.length === 25) {
      console.log("🔎 25 orders detected → trying page 2");

      const page2Button = page.locator(
        'li.a-declarative[data-a-dtt-page="2"]'
      );

      try {
        const isVisible = await page2Button.isVisible({ timeout: 3000 });

        if (isVisible) {
          await pause("Перед кликом Page 2");
          await page2Button.click({ force: true });

          // ждём перезагрузку таблицы
          await pause("Ждём загрузку второй страницы");

          const page2Orders = await parseOrdersFromCurrentPage(page);

          if (page2Orders.length > 0) {
            console.log(
              `📦 Page 2 parsed: ${page2Orders.length} orders`
            );
            allOrders = [...page1Orders, ...page2Orders];
          }
        } else {
          console.log("ℹ️ Page 2 not available");
        }
      } catch (err) {
        console.log("⚠️ Could not navigate to page 2");
      }
    }

    console.log("📦 TOTAL ORDERS:", allOrders.length);
    console.log(JSON.stringify(allOrders, null, 2));

    return allOrders;
  } finally {
    await pause("Закрываем браузер");
    await context.close();
    console.log("🧹 Браузер закрыт");
  }
}
