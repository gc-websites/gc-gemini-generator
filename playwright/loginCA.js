import { chromium } from "playwright";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve("../.env") });

async function loginCA() {
  const userDataDir = path.resolve("./amazon-ca-session");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });

  const page = await context.newPage();

  // Логинимся на том домене, который нужен и createTagCA
  await page.goto(
    "https://www.amazon.ca/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fassociates.amazon.ca%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_associates_ca&openid.mode=checkid_setup&marketPlaceId=A2EUQ1WTGCTBG2&language=en_CA&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
    { waitUntil: "load" }
  );

  console.log("LANDING:", page.url());

  // Если уже авторизованы — редирект может сразу пойти в home
  const currentUrl = page.url();
  if (
    currentUrl.includes("associates.amazon.ca/home") ||
    currentUrl.includes("affiliate-program.amazon.ca/home")
  ) {
    console.log("🔐 Уже авторизовано — сессия восстановлена");
    await context.close();
    return;
  }

  console.log("➡️ Запуск логина...");

  // Email
  await page.waitForSelector("#ap_email");
  await page.fill("#ap_email", process.env.AMAZON_EMAIL);
  await page.click("#continue");

  // Пароль
  await page.waitForSelector("#ap_password");
  await page.fill("#ap_password", process.env.AMAZON_PASSWORD);
  await page.click("#signInSubmit");

  // Ждём переход в кабинет
  await page.waitForURL(
    (u) => {
      const url = u.toString();
      return (
        url.includes("associates.amazon.ca/home") ||
        url.includes("affiliate-program.amazon.ca/home")
      );
    },
    { timeout: 30000 }
  );

  console.log("🎉 Логин успешный, сессия сохранена → amazon-ca-session/");

  await context.close();
}

loginCA();
