import { test, expect } from '@playwright/test';

test('Production site comprehensive check', async ({ page }) => {
  const consoleLogs: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', error => {
    consoleErrors.push(`Page Error: ${error.message}\n${error.stack}`);
  });

  console.log('\n=== Accessing Production Site ===');
  await page.goto('https://welfare-assist-pro.web.app/', { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for app to initialize
  await page.waitForTimeout(15000);

  // Take screenshot
  await page.screenshot({ path: 'production-check.png', fullPage: true });

  // Check page elements
  const bodyText = await page.locator('body').textContent();
  const hasLoginUI = await page.locator('text=/ログイン|サインイン|Google/i').count() > 0;
  const hasLoadingText = await page.locator('text=読み込み中').count() > 0;
  const hasErrorText = await page.locator('text=/エラー|Error/i').count() > 0;
  const hasAppTitle = await page.locator('text=/WelfareAssist|福祉用具マネージャー/i').count() > 0;

  console.log('\n=== Page Analysis ===');
  console.log('Has App Title:', hasAppTitle);
  console.log('Has Login UI:', hasLoginUI);
  console.log('Has Loading Text (should be false):', hasLoadingText);
  console.log('Has Error Text:', hasErrorText);
  console.log('Body Text Length:', bodyText?.length || 0);
  console.log('Body Preview:', bodyText?.substring(0, 200));

  console.log('\n=== Console Logs (last 20) ===');
  consoleLogs.slice(-20).forEach(log => console.log(log));

  if (consoleErrors.length > 0) {
    console.log('\n=== Console Errors ===');
    consoleErrors.forEach(err => console.log(err));
  }

  // Assertions
  expect(hasAppTitle).toBe(true);
  expect(hasLoadingText).toBe(false);
  expect(bodyText).toBeTruthy();
});
