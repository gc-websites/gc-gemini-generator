import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const runAmazonCCApproval = async (purchases) => {
  if (!purchases || purchases.length === 0) return purchases;

  const STRAPI_URL = process.env.STRAPI_API_URL;
  const STRAPI_TOKEN = process.env.STRAPI_TOKEN;

  const userDataDir = join(__dirname, 'playwright', 'amazon-us-session');
  console.log(`[AmazonCC] Launching headless browser for ASIN approval using persistent context at ${userDataDir}`);

  let browserContext;

  try {
    browserContext = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 720 }
    });

    const page = browserContext.pages()[0] || await browserContext.newPage();

    for (const purchase of purchases) {
      const asin = purchase.ASIN;
      const event_source_url = purchase.event_source_url;

      if (!asin || !event_source_url) {
        console.log(`[AmazonCC] Skipping purchase ${purchase.documentId} - missing ASIN or event_source_url`);
        continue;
      }

      console.log(`\n[AmazonCC] Processing ASIN: ${asin} for purchase ${purchase.documentId}`);

      let ccRate = null;
      let isHaveCCProg = false;
      let isChecked = false;
      let hasError = false;

      try {
        console.log(`[AmazonCC] Navigating to Creator Connections home to search for ${asin}`);
        await page.goto('https://affiliate-program.amazon.com/p/connect/requests', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        const searchInput = page.getByPlaceholder('Search brand, keyword, or ASIN');
        await searchInput.waitFor({ state: 'visible', timeout: 15000 });

        const newOppTab = page.locator('button[role="tab"]:has-text("New Opportunities"), a[role="tab"]:has-text("New Opportunities"), div[role="tab"]:has-text("New Opportunities")').first();
        if (await newOppTab.count() > 0 && await newOppTab.isVisible()) {
          await newOppTab.click({ force: true });
          await page.waitForTimeout(2000);
        }

        await searchInput.click();
        await page.waitForTimeout(500);
        await searchInput.fill('');
        await page.keyboard.type(asin, { delay: 100 });
        await page.waitForTimeout(1000);
        await searchInput.press('Enter');
        await page.waitForTimeout(4000);

        const acceptBtns = await page.getByRole('button', { name: /Accept|Apply/i }).elementHandles();
        if (acceptBtns.length > 0) {
          await acceptBtns[0].scrollIntoViewIfNeeded();
          await acceptBtns[0].click({ force: true });
          await page.waitForTimeout(4000);

          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(4000);

          await page.waitForSelector('text=Active', { state: 'visible', timeout: 10000 }).catch(() => { });
          const activeCandidates = await page.locator('text="Active"').elementHandles();
          for (const el of activeCandidates) {
            const isVisible = await el.isVisible();
            const tagName = await el.evaluate(e => e.tagName.toLowerCase());
            if (isVisible && (tagName === 'a' || tagName === 'button' || tagName === 'span' || tagName === 'div')) {
              await el.scrollIntoViewIfNeeded();
              await el.click({ force: true });
              break;
            }
          }

          await page.waitForTimeout(6000);

          const searchLocator = page.getByPlaceholder('Search brand, keyword, or ASIN').last();
          if (await searchLocator.count() > 0) {
            await searchLocator.click();
            await page.waitForTimeout(500);
            await searchLocator.fill('');
            await page.keyboard.type(asin, { delay: 100 });
            await page.waitForTimeout(1000);
            await searchLocator.press('Enter');
            await page.waitForTimeout(6000);
          }

          const cardContainers = await page.locator('[data-testid="campaign-card-container"]').elementHandles();
          if (cardContainers.length > 0) {
            await cardContainers[0].scrollIntoViewIfNeeded();
            await cardContainers[0].click({ force: true });
            await page.waitForTimeout(3000);

            const viewDetails = await page.$('[data-testid="campaign-card-view-details-link"]');
            if (viewDetails) {
              await viewDetails.click({ force: true });
              await page.waitForTimeout(2000);
            }

            await page.waitForTimeout(4000);

            const pageBodyText = await page.locator('body').innerText();
            const rateMatch = pageBodyText.match(/Commission rate[\s\S]{0,30}?([\d.]+)%/i);
            if (rateMatch && rateMatch[1]) {
              ccRate = parseFloat(rateMatch[1]);
            }

            const contentTypeTrigger = page.locator('text=/Select a content type/i').first();
            if (await contentTypeTrigger.count() > 0) {
              await contentTypeTrigger.scrollIntoViewIfNeeded();
              await contentTypeTrigger.click({ force: true });
              await page.waitForTimeout(1500);
              const articleOption = page.locator('text=/Article or blog post/i').first();
              if (await articleOption.count() > 0) {
                await articleOption.click({ force: true });
              }
            }

            await page.waitForTimeout(1000);

            const urlInput = page.getByPlaceholder('Enter URL').last();
            if (await urlInput.count() > 0) {
              await urlInput.scrollIntoViewIfNeeded();
              await urlInput.click();
              await urlInput.fill('');
              await page.keyboard.type(event_source_url, { delay: 50 });
              await page.waitForTimeout(1000);
              await urlInput.press('Tab');
              isChecked = true;
            }

            const submitBtn = page.locator('button:has-text("Submit")').last();
            if (await submitBtn.count() > 0) {
              await submitBtn.scrollIntoViewIfNeeded();
              await submitBtn.click({ force: true });

              try {
                // Wait for either the success message OR the "Please select a content type" error
                await Promise.race([
                  page.locator('text=/Link was successfully submitted/i').waitFor({ state: 'visible', timeout: 5000 }),
                  page.locator('text=/Please select a content type/i').waitFor({ state: 'visible', timeout: 5000 })
                ]);
              } catch (e) {
                // Ignore timeout, we will check visibility below
              }

              // Check if the "Please select a content type" error is visible
              const contentTypeError = page.locator('text=/Please select a content type/i');
              if (await contentTypeError.count() > 0 && await contentTypeError.isVisible()) {
                console.log(`[AmazonCC] "Please select a content type" error detected. Retrying selection...`);
                // Try to select it again
                if (await contentTypeTrigger.count() > 0) {
                  await contentTypeTrigger.scrollIntoViewIfNeeded();
                  await contentTypeTrigger.click({ force: true });
                  await page.waitForTimeout(1500);
                  const articleOption = page.locator('text=/Article or blog post/i').first();
                  if (await articleOption.count() > 0) {
                    await articleOption.click({ force: true });
                  }
                }
                await page.waitForTimeout(1000);

                // Click submit again
                await submitBtn.click({ force: true });
                await page.waitForTimeout(3000);
              }

              const successOverlay = page.locator('text=/Link was successfully submitted/i');
              if (await successOverlay.count() > 0 && await successOverlay.isVisible()) {
                isHaveCCProg = true;
              } else if (ccRate) {
                isHaveCCProg = true;
              }
            } else {
              if (ccRate) {
                isHaveCCProg = true;
              }
            }
          } else {
            isChecked = true;
          }
        } else {
          isChecked = true;
        }
      } catch (error) {
        console.error(`[AmazonCC] Error processing ASIN ${asin}:`, error.message);
        hasError = true;
      }

      if (hasError) {
        console.log(`[AmazonCC] Skipping Strapi update for ${purchase.documentId} because an error occurred during processing.`);
        continue;
      }

      // Update Strapi for this purchase
      const updateData = {
        CCChecked: true
      };

      if (ccRate) {
        updateData.isCCCommission = true;
        updateData.ccRate = ccRate;

        const baseCommission = purchase.commission || 0;
        const generalPercent = baseCommission + ccRate;
        const newTotalValue = (generalPercent / 100) * (purchase.price * purchase.orderedCount);

        updateData.value = Number(newTotalValue.toFixed(2));

        // Update purchase object in memory
        purchase.ccRate = ccRate;
        purchase.value = updateData.value;
      }

      try {
        const updateRes = await fetch(`${STRAPI_URL}/api/purchases/${purchase.documentId}`, {
          method: 'PUT',
          headers: {
            Authorization: STRAPI_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ data: updateData })
        });

        if (!updateRes.ok) {
          const text = await updateRes.text();
          console.error(`[AmazonCC] Failed to update purchase ${purchase.documentId} in Strapi:`, text);
        } else {
          console.log(`[AmazonCC] Successfully updated purchase ${purchase.documentId} in Strapi with CC data.`);
        }
      } catch (err) {
        console.error(`[AmazonCC] Network error while updating purchase ${purchase.documentId}:`, err);
      }
    }

  } catch (error) {
    console.error("[AmazonCC] Automation Error:", error);
  } finally {
    if (browserContext) {
      console.log(`[AmazonCC] Closing browser...`);
      await browserContext.close();
    }
  }

  return purchases;
};
