import { chromium } from "playwright";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function debugES() {
  const context = await chromium.launchPersistentContext(path.resolve("./amazon-es-session"), {
    headless: false,
    locale: "es-ES"
  });

  const page = await context.newPage();

  await page.goto("https://afiliados.amazon.es/", { waitUntil: "domcontentloaded" });
  console.log("LANDING:", page.url());

  if (page.url().includes("afiliados.amazon.es/home")) {
    console.log("🔐 Уже авторизовано");
    await context.close();
    return;
  }

  console.log("➡️ Переход на страницу логина...");
  await page.waitForSelector("a[href='/login']", { timeout: 10000 });
  await page.click("a[href='/login']");

  console.log("➡️ Ожидание формы логина...");

  try {
    // Ввод Email
    await page.waitForSelector("#ap_email_login", { timeout: 10000 });
    await page.fill("#ap_email_login", process.env.AMAZON_EMAIL);
    await page.click("#continue");

    console.log("➡️ Email entered, waiting for password form...");
    await page.waitForSelector("#ap_password", { timeout: 10000 });
    await page.fill("#ap_password", process.env.AMAZON_PASSWORD);

    // Let's delay slightly to act like a human
    await page.waitForTimeout(1000);
    await page.click("#signInSubmit");

    console.log("➡️ Password submitted. Waiting 5s to see what page we land on.");
    await page.waitForTimeout(5000);

    console.log("Dump HTML after password step");
    const html = await page.content();
    fs.writeFileSync("playwright/after_password.html", html);
    await page.screenshot({ path: 'playwright/after_password.png' });

  } catch (error) {
    console.error("Error during debug:", error);
  }

  await context.close();
}

debugES();
