import { chromium } from 'playwright';

function uuidLite() {
  return Math.random().toString(36).substring(2, 8);
}

async function runTest() {
  console.log("🚀 Запуск теста создания тега на Испании...");

  const context = await chromium.launchPersistentContext("./playwright/amazon-es-session", {
    headless: false,
    locale: "es-ES"
  });

  try {
    const page = await context.newPage();
    console.log("⏳ Переходим на страницу...");

    // Используем domcontentloaded вместо networkidle, чтобы не зависать, если какой-то трекер грузится вечно
    await page.goto("https://afiliados.amazon.es/home/account/tag/manage", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    console.log("✅ Страница загружена. URL:", page.url());

    const currentUrl = page.url();
    if (currentUrl.includes("signin") || currentUrl.includes("ap/signin")) {
      console.log('❌ Сессия недействительна — нужно заново залогиниться');
      return;
    }

    console.log('✔️ Сессия активна');

    const addButton = page.locator('button#a-autoid-2-announce');
    console.log('➡️ Ожидание кнопки добавления...');
    await addButton.waitFor({ state: 'visible', timeout: 15000 });

    // Ждём чуть-чуть перед кликом для стабильности
    await page.waitForTimeout(1000);
    await addButton.click();

    const modal = page.locator('#a-popover-1');
    console.log('➡️ Ожидание модального окна...');
    await modal.waitFor({ state: 'visible', timeout: 15000 });

    const input = page.locator('#ac-tag-create-tag_name');
    console.log('➡️ Ожидание поля ввода (input)...');
    await input.waitFor({ state: 'visible', timeout: 10000 });

    const subtag = `subtag-${uuidLite()}`;
    console.log('➡️ Вводим субтег:', subtag);

    // Вводим текст посимвольно (delay) для имитации человека
    await input.fill(subtag, { delay: 100 });
    await page.waitForTimeout(500);
    await input.evaluate(el => el.blur());

    const createWrapper = page.locator('span[data-action="ac-tag-create-action"]');
    console.log('➡️ Ожидание обертки кнопки...');
    await createWrapper.waitFor({ state: 'visible', timeout: 10000 });

    const createBtn = createWrapper.locator('button');
    console.log('➡️ Клик по кнопке создания...');
    await page.waitForTimeout(500);
    await createBtn.click({ force: true });

    console.log('➡️ Ожидание результата от Амазона...');
    const successBox = page.locator('#ac-tag-new-container');
    const suggestionBox = page.locator('#ac-tag-suggestion-container');
    const errorBox = page.locator('#ac-tag-create-error-container');

    const resultRace = await Promise.race([
      successBox.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'success').catch(() => null),
      suggestionBox.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'suggestion').catch(() => null),
      errorBox.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'error').catch(() => null),
    ]);

    console.log('✅ Исход:', resultRace);

    if (resultRace === 'success') {
      const msg = await successBox.innerText();
      console.log("🎉 Одобрено: ", msg.trim());
    } else if (resultRace === 'suggestion') {
      console.log("⚠️ Тег занят");
    } else if (resultRace === 'error') {
      const msg = await errorBox.innerText();
      console.log("❌ Ошибка Амазона: ", msg.trim());
    } else {
      console.log("❓ Неизвестный результат (таймаут или не видно окон)");
    }

  } catch (err) {
    console.error("🔥 Ошибка выполнения:", err);
  } finally {
    console.log("🔒 Закрываем браузер...");
    await context.close();
    console.log("🏁 Тест завершен");
  }
}

runTest();
