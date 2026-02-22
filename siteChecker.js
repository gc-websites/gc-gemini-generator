import { chromium } from 'playwright';

export async function checkSitesAvailability() {
  const sites = [
    'https://nice-advice.info/',
    'https://cholesterintipps.de/',
    'https://hairstylesforseniors.com/'
  ];

  const results = [];

  // Launch Playwright in headless mode
  const browser = await chromium.launch({ headless: true });

  for (const site of sites) {
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Navigate to the site and wait for DOM loaded
      const response = await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (response && response.ok()) {
        results.push(`✅ ${site} is working normally (Status: ${response.status()})`);
      } else {
        results.push(`❌ ${site} might have issues! (Status: ${response ? response.status() : 'No response'})`);
      }

      await context.close();
    } catch (error) {
      results.push(`❌ ${site} failed to open: ${error.message}`);
    }
  }

  await browser.close();

  // Format the output
  const header = `🌍 *Daily Site Status Check* 🌍\n\n`;
  return header + results.join('\n');
}
