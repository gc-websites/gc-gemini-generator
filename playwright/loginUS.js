import { chromium } from "playwright";
import dotenv from "dotenv";
import path from "path";

// Загружаем .env из родительской директории
dotenv.config({ path: path.resolve("../.env") });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://affiliate-program.amazon.com/");

  // Кнопка Sign In
  await page.click("#a-autoid-0-announce");

  // Ввод email
  await page.fill("#ap_email", process.env.AMAZON_EMAIL);
  await page.click("#continue");

  // Ввод пароля
  await page.fill("#ap_password", process.env.AMAZON_PASSWORD);
  await page.click("#signInSubmit");

  console.log("🔔 Если Amazon запросит код MFA — введи его вручную.");

  // После продолжения Playwright пойдёт дальше
  console.log("✅ MFA подтверждён. Сохраняю сессию...");

  await context.storageState({ path: "amazon-sessionUS.json" });

  console.log("🎉 Сессия сохранена → amazon-sessionUS.json");
  await browser.close();
}

run();
