import { chromium } from 'playwright';

function uuidLite() {
  return Math.random().toString(36).substring(2, 8);
}

export async function createTagES() {
  const context = await chromium.launchPersistentContext("./playwright/amazon-es-session", {
    headless: false,
    locale: "es-ES"
  });

  try {
    const page = await context.newPage();
    await page.goto("https://afiliados.amazon.es/home/account/tag/manage", {
      waitUntil: "networkidle"
    });
    console.log("LANDING URL:", page.url());

    // Проверяем реальный URL Amazon login
    const currentUrl = page.url();
    if (currentUrl.includes("signin") || currentUrl.includes("ap/signin")) {
      console.log('❌ Сессия недействительна — нужно заново залогиниться');
      return {
        ok: false,
        tag: null,
        message: "invalid session"
      };
    }

    console.log('✔️ Сессия активна');

    const addButton = page.locator('button#a-autoid-2-announce');
    console.log('➡️ Ожидание кнопки добавления...');
    await addButton.waitFor({ state: 'visible', timeout: 30000 });
    await addButton.click();

    const modal = page.locator('#a-popover-1');
    console.log('➡️ Ожидание модалки...');
    await modal.waitFor({ state: 'visible', timeout: 30000 });

    const input = page.locator('#ac-tag-create-tag_name');
    console.log('➡️ Ожидание поля ввода...');
    await input.waitFor({ state: 'visible', timeout: 30000 });

    const subtag = `subtag-${uuidLite()}`;
    console.log('➡️ Генерируем субтег:', subtag);

    await input.fill(subtag);
    await input.evaluate(el => el.blur());

    const createWrapper = page.locator('span[data-action="ac-tag-create-action"]');
    console.log('➡️ Ожидание враппера кнопки создания...');
    await createWrapper.waitFor({ state: 'visible', timeout: 30000 });

    const createBtn = createWrapper.locator('button');
    console.log('➡️ Клик по кнопке создания...');
    await page.waitForTimeout(500);
    await createBtn.click({ force: true });

    console.log('➡️ Ожидание ответа от амазона (успех/ошибка)...');
    const successBox = page.locator('#ac-tag-new-container'); // wait for any text in ES, US has { hasText: 'created successfully' } 
    // Let's remove hasText filter for successBox since it will be in Spanish
    // The element itself #ac-tag-new-container should become visible on success
    const suggestionBox = page.locator('#ac-tag-suggestion-container');
    const errorBox = page.locator('#ac-tag-create-error-container');

    await Promise.race([
      successBox.waitFor({ timeout: 15000 }).catch(() => null),
      suggestionBox.waitFor({ timeout: 15000 }).catch(() => null),
      errorBox.waitFor({ timeout: 15000 }).catch(() => null),
    ]);

    let result = { ok: false, tag: subtag, message: null };

    if (await successBox.isVisible()) {
      result.ok = true;
      result.message = (await successBox.innerText()).trim();
    } else if (await suggestionBox.isVisible()) {
      result.message = 'subtag already taken';
    } else if (await errorBox.isVisible()) {
      result.message = (await errorBox.innerText()).trim();
    } else {
      // maybe wait a bit more or fallback
      result.message = 'unknown status, Amazon did not respond';
    }

    return result;

  } catch (error) {
    console.log("❌ Playwright error:", error.message);
    return { ok: false, tag: null, message: error.message };
  } finally {
    await context.close();
  }
}
