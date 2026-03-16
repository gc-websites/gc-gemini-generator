import { chromium } from "playwright";
import dotenv from "dotenv";
import path from "path";

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
async function loginES() {
  const userDataDir = path.resolve("./amazon-es-session");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    locale: "es-ES"
  });

  const page = await context.newPage();

  // Логинимся на испанском домене
  await page.goto(
    "https://afiliados.amazon.es/",
    { waitUntil: "domcontentloaded" }
  );

  console.log("LANDING:", page.url());

  // Если уже авторизованы — редирект может сразу пойти в home
  if (page.url().includes("afiliados.amazon.es/home")) {
    console.log("🔐 Уже авторизовано — сессия восстановлена");
    await context.close();
    return;
  }

  // Кликаем по кнопке Входа
  console.log("➡️ Переход на страницу логина...");
  await page.waitForSelector("a[href='/login']", { timeout: 10000 });
  await page.click("a[href='/login']");

  console.log("➡️ Ожидание формы логина...");

  try {
    // Ввод Email
    await page.waitForSelector("#ap_email_login", { timeout: 10000 });
    await page.fill("#ap_email_login", process.env.AMAZON_EMAIL);
    await page.click("#continue");

    // Ввод пароля
    await page.waitForSelector("#ap_password", { timeout: 10000 });
    await page.fill("#ap_password", process.env.AMAZON_PASSWORD);
    await page.click("#signInSubmit");
  } catch (error) {
    console.log("⚠️ Не удалось автоматически заполнить логин/пароль. Ошибка: " + error.message);
    console.log("Возможно интерфейс изменен или требуется ручной ввод. Заполните вручную вместе с капчей/2FA.");
  }

  console.log("===============================================================");
  console.log("🚨 ВНИМАНИЕ: Amazon запрашивает 2FA код или капчу! 🚨");
  console.log("Откройте окно Chromium, которое только что запустилось,");
  console.log("и введите код двухфакторной аутентификации или решите капчу.");
  console.log("У вас есть 2 минуты. После входа скрипт сам сохранит сессию.");
  console.log("===============================================================");

  // Ждём переход в кабинет
  await page.waitForURL(
    (u) => {
      const url = u.toString();
      return url.includes("afiliados.amazon.es/home");
    },
    { timeout: 120000 }
  );

  console.log("🎉 Логин успешный, сессия сохранена → amazon-es-session/");

  await context.close();
}

loginES();
