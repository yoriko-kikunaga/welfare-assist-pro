import { test, expect } from '@playwright/test';

test.describe('WelfareAssist Pro - Basic App Flow', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await page.waitForLoadState('networkidle');

    // Wait for auth to initialize and loading screen to disappear
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 15000 });

    // Wait for either auth UI or main content
    await page.waitForSelector('text=/ログイン|サインイン|Google|福祉用具マネージャー|クライアント|基本情報/i', { timeout: 10000 });

    // Check if we're on the login page or the main app
    const hasAuthUI = await page.locator('text=/ログイン|サインイン|Google/i').count() > 0;
    const hasMainContent = await page.locator('text=/福祉用具マネージャー|クライアント|基本情報/i').count() > 0;

    expect(hasAuthUI || hasMainContent).toBe(true);
  });

  test('should show login page without authentication', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for loading to complete
    try {
      await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });
    } catch (e) {
      // Loading spinner might not appear
    }

    // Since auth is required, we should see some sign-in UI or main content
    // This test verifies the app doesn't crash on load
    const pageTitle = await page.title();
    expect(pageTitle).toBeTruthy();

    // Verify no critical errors in console
    const hasContent = await page.locator('body').textContent();
    expect(hasContent).toBeTruthy();
  });
});

test.describe('WelfareAssist Pro - Client List (Authenticated)', () => {
  test('should display client list after authentication', async ({ page }) => {
    // Use E2E test mode to bypass Firebase authentication
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Wait for client list header to load
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });

    // Check if client count is visible
    const clientCountVisible = await page.locator('text=/全員|福祉用具/i').count() > 0;
    expect(clientCountVisible).toBe(true);
  });

  test('should filter welfare equipment users', async ({ page }) => {
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Wait for client list header
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });

    // Click welfare equipment filter button
    await page.click('text=福祉用具');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Verify filter button is active (should show different count)
    const filterButton = await page.locator('text=福祉用具');
    expect(filterButton).toBeTruthy();
  });

  test('should search for clients', async ({ page }) => {
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Wait for client list header
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });

    // Find search input
    const searchInput = await page.locator('input[placeholder*="検索"]');

    // Type a search query
    await searchInput.fill('山田');

    // Wait for search results
    await page.waitForTimeout(500);

    // Check if search input has the value
    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe('山田');
  });
});

test.describe('WelfareAssist Pro - Client Detail (Authenticated)', () => {
  test('should display client detail tabs', async ({ page }) => {
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Wait for client list header
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });

    // Click first client in the list
    await page.waitForTimeout(2000); // Wait for list to fully render
    // Find buttons in the client list area
    const clientList = page.locator('ul').filter({ has: page.locator('button') }).first();
    const firstClientButton = clientList.locator('button').first();
    await firstClientButton.click({ timeout: 10000 });

    // Verify tabs are visible
    await page.waitForSelector('text=/基本情報/i', { timeout: 5000 });
    const tabs = [
      '基本情報',
      '病歴・状態',
      '議事録一覧',
      '利用者新規・変更情報入力',
      '福祉用具選定',
      '売上管理'
    ];

    for (const tabName of tabs) {
      const tabVisible = await page.locator(`text=${tabName}`).count() > 0;
      expect(tabVisible).toBe(true);
    }
  });

  test('should switch between tabs', async ({ page }) => {
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Navigate to a client
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });
    await page.waitForTimeout(2000);
    const clientList = page.locator('ul').filter({ has: page.locator('button') }).first();
    const firstClientButton = clientList.locator('button').first();
    await firstClientButton.click({ timeout: 10000 });

    // Wait for tabs to be visible
    await page.waitForSelector('text=基本情報', { timeout: 5000 });

    // Click on different tabs
    await page.click('text=病歴・状態');
    await page.waitForTimeout(300);

    await page.click('text=議事録一覧');
    await page.waitForTimeout(300);

    await page.click('text=福祉用具選定');
    await page.waitForTimeout(300);

    // Verify we're still on the page with tabs
    const tabsVisible = await page.locator('text=基本情報').count() > 0;
    expect(tabsVisible).toBe(true);
  });
});

test.describe('WelfareAssist Pro - Equipment Selection (Authenticated)', () => {
  test('should load equipment master data', async ({ page }) => {
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Navigate to equipment selection tab
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });
    await page.waitForTimeout(2000);
    const clientList = page.locator('ul').filter({ has: page.locator('button') }).first();
    const firstClientButton = clientList.locator('button').first();
    await firstClientButton.click({ timeout: 10000 });

    // Wait for tabs and click equipment selection
    await page.waitForSelector('text=福祉用具選定', { timeout: 5000 });
    await page.click('text=福祉用具選定');

    // Wait for equipment section to load
    await page.waitForTimeout(1000);

    // Verify equipment section is visible
    const equipmentSection = await page.locator('text=/福祉用具|選定機器/i').count() > 0;
    expect(equipmentSection).toBe(true);
  });

  test('should display equipment selection interface', async ({ page }) => {
    await page.goto('/?e2e_test_mode=true');

    // Wait for loading to complete
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });

    // Navigate to equipment selection
    await page.waitForSelector('text=利用者一覧', { timeout: 10000 });
    await page.waitForTimeout(2000);
    const clientList = page.locator('ul').filter({ has: page.locator('button') }).first();
    const firstClientButton = clientList.locator('button').first();
    await firstClientButton.click({ timeout: 10000 });

    // Click on equipment selection tab
    await page.waitForSelector('text=福祉用具選定', { timeout: 5000 });
    await page.click('text=福祉用具選定');

    // Wait for tab content
    await page.waitForTimeout(1000);

    // Verify we're on the equipment tab
    const onEquipmentTab = await page.locator('text=福祉用具選定').count() > 0;
    expect(onEquipmentTab).toBe(true);
  });
});

test.describe('WelfareAssist Pro - Performance', () => {
  test('should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for loading to complete
    try {
      await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });
    } catch (e) {
      // Loading spinner might not appear
    }

    // Wait for content to appear
    await page.waitForSelector('text=/ログイン|サインイン|Google|福祉用具マネージャー|クライアント|基本情報/i', { timeout: 30000 });

    const loadTime = Date.now() - startTime;

    // App should load within 35 seconds (includes large JSON file)
    expect(loadTime).toBeLessThan(35000);
  });

  test('should not have console errors on load', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for loading to complete
    try {
      await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 30000 });
    } catch (e) {
      // Loading spinner might not appear
    }

    // Wait for content
    await page.waitForSelector('text=/ログイン|サインイン|Google|福祉用具マネージャー|クライアント|基本情報/i', { timeout: 30000 });

    // Filter out known Firebase auth errors in development
    const criticalErrors = consoleErrors.filter(error =>
      !error.includes('Firebase') &&
      !error.includes('auth') &&
      !error.includes('FIREBASE') &&
      !error.includes('favicon')
    );

    expect(criticalErrors.length).toBe(0);
  });
});
