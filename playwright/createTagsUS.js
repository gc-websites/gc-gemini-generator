import { chromium } from 'playwright';

function uuidLite() {
  return Math.random().toString(36).substring(2, 8);
}

export async function createTagUS() {
  const context = await chromium.launchPersistentContext("./playwright/amazon-us-session", {
    headless: false
  });

  const page = await context.newPage();
  await page.goto("https://affiliate-program.amazon.com/home/account/tag/manage", {
    waitUntil: "networkidle"
  });
  console.log("LANDING URL:", page.url());


  // Проверяем реальный URL Amazon login
  const currentUrl = page.url();
  if (currentUrl.includes("signin") || currentUrl.includes("ap/signin")) {
    console.log('❌ Сессия недействительна — нужно заново залогиниться');
    await context.close();
    return {
      ok: false,
      tag: null,
      message: "invalid session"
    };
  }

  console.log('✔️ Сессия активна');

  const addButton = page.locator('button#a-autoid-2-announce');
  await addButton.waitFor({ timeout: 15000 });
  await addButton.click();

  const modal = page.locator('#a-popover-1');
  await modal.waitFor({ timeout: 15000 });

  const input = page.locator('#ac-tag-create-tag_name');
  await input.waitFor({ timeout: 10000 });

  const subtag = `subtag-${uuidLite()}`;
  console.log('➡️ Генерируем субтег:', subtag);

  await input.fill(subtag);
  await input.evaluate(el => el.blur());

  const createWrapper = page.locator('span[data-action="ac-tag-create-action"]');
  await createWrapper.waitFor({ timeout: 10000 });

  const createBtn = createWrapper.locator('button');
  await page.waitForTimeout(500);
  await createBtn.click({ force: true });

  const successBox = page.locator('#ac-tag-new-container', { hasText: 'created successfully' });
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
    result.message = 'unknown status, Amazon did not respond';
  }

  await context.close();
  return result;
}