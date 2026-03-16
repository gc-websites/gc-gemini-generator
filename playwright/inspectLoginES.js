import { chromium } from "playwright";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve("../.env") });

async function inspectLoginForm() {
  const userDataDir = path.resolve("./amazon-es-session-test");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    locale: "es-ES"
  });

  const page = await context.newPage();

  console.log("Navigating to ES affiliate landing...");

  await page.goto(
    "https://afiliados.amazon.es/",
    { waitUntil: "domcontentloaded" }
  );

  await page.waitForTimeout(2000);

  console.log("Current URL:", page.url());

  console.log("Clicking login...");
  await page.waitForSelector("a[href='/login']", { timeout: 10000 });
  await page.click("a[href='/login']");

  // Wait for the new page to load which might have the inputs
  await page.waitForTimeout(5000);

  console.log("Form URL:", page.url());

  const content = await page.content();
  fs.writeFileSync("amazon_es_login_form.html", content);
  console.log("Saved login form content to amazon_es_login_form.html");

  await context.close();
}

inspectLoginForm();
