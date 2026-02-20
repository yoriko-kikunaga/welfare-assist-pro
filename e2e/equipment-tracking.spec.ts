/**
 * E2E tests for EquipmentTrackingPage (個体管理)
 *
 * Prerequisites:
 *   1. Start Firebase Emulators: npm run emulators
 *   2. Run: npm run test:e2e:emulator
 *
 * Auth strategy:
 *   - e2e_test_mode=true → mock user (synchronous, no Firebase call)
 *   - Firestore emulator: beforeAll sets permissive rules (allow all reads/writes)
 *   - This tests FE→Firestore CRUD without Firestore auth complexity
 *
 * Design: each test is SELF-CONTAINED (creates its own Firestore data).
 * This avoids failures when Playwright re-initialises the worker between tests.
 */

import { test, expect, Page, request as apiRequest } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

const BASE_URL       = 'http://localhost:3001';
const E2E_URL        = `${BASE_URL}/?e2e_test_mode=true`;
const FIRESTORE_HOST = 'http://127.0.0.1:8080';
const PROJECT_ID     = 'welfare-assist-pro';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

async function setPermissiveFirestoreRules() {
  const ctx = await apiRequest.newContext();
  await ctx.put(
    `${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`,
    {
      data: {
        rules: {
          files: [{
            name: 'firestore.rules',
            content: [
              'rules_version = "2";',
              'service cloud.firestore {',
              '  match /databases/{database}/documents {',
              '    match /{document=**} {',
              '      allow read, write: if true;',
              '    }',
              '  }',
              '}'
            ].join('\n')
          }]
        }
      }
    }
  );
  await ctx.dispose();
}

async function clearAllFirestoreData() {
  const ctx = await apiRequest.newContext();
  await ctx.delete(
    `${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  );
  await ctx.dispose();
}

/** Navigate to the app in E2E mode and wait for sidebar */
async function openApp(page: Page) {
  await page.goto(E2E_URL);
  await expect(page.locator('button', { hasText: '個体管理' }).first())
    .toBeVisible({ timeout: 30_000 });
}

/** Click the "個体管理" sidebar button, wait until EquipmentTrackingPage fully loads */
async function openEquipmentTracking(page: Page) {
  await page.locator('button', { hasText: '個体管理' }).first().click();
  await expect(page.locator('button').filter({ hasText: '新規登録' }))
    .toBeVisible({ timeout: 30_000 });
}

/**
 * Register a new equipment item through the UI and return the item name.
 * Waits for the item to appear in the list before returning.
 */
async function registerItem(page: Page, itemName: string) {
  await page.locator('button').filter({ hasText: '新規登録' }).click();
  await expect(page.getByRole('heading', { name: '機材を新規登録' })).toBeVisible();
  await page.getByPlaceholder('例: 高さ調節ベッド').fill(itemName);
  // Save (AddEditModal button text: "保存")
  await page.locator('button').filter({ hasText: '保存' }).click();
  await expect(page.getByRole('heading', { name: '機材を新規登録' })).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });
}

/**
 * Transition item status via StatusChangeModal.
 * toStatus must be reachable from the current state + usageType.
 * Does NOT require client selection when toStatus is '施設物品'.
 */
async function changeStatus(page: Page, itemName: string, toStatus: string) {
  const row = page.locator('tr', { hasText: itemName });
  // Open the status change modal (貸出 button is always shown for items in 倉庫保管+介護保険)
  await row.locator('button').filter({ hasText: '貸出' }).click();
  await expect(page.getByRole('heading', { name: 'ステータス変更' })).toBeVisible();
  // 次のステータス is the SECOND select (first is 用途区分)
  const selects = page.locator('.fixed').last().locator('select');
  await selects.nth(1).selectOption(toStatus);
  // Save (StatusChangeModal button text: "変更する")
  await page.locator('button').filter({ hasText: '変更する' }).click();
  await expect(page.getByRole('heading', { name: 'ステータス変更' })).not.toBeVisible({ timeout: 10_000 });
  await expect(row.getByText(toStatus)).toBeVisible({ timeout: 15_000 });
}

// ────────────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  await setPermissiveFirestoreRules();
  await clearAllFirestoreData();
});

// ────────────────────────────────────────────────────────────────────
// Test 1: 機材の新規登録
// ────────────────────────────────────────────────────────────────────

test('機材の新規登録', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  const itemName = 'テストベッド_登録';

  await page.locator('button').filter({ hasText: '新規登録' }).click();
  await expect(page.getByRole('heading', { name: '機材を新規登録' })).toBeVisible();
  await page.getByPlaceholder('例: 高さ調節ベッド').fill(itemName);
  await page.locator('input[type="date"]').fill('2026-01-01');
  await page.locator('input[placeholder="0"]').fill('50000');
  // Save (AddEditModal button text: "保存")
  await page.locator('button').filter({ hasText: '保存' }).click();

  await expect(page.getByRole('heading', { name: '機材を新規登録' })).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

  const row = page.locator('tr', { hasText: itemName });
  await expect(row.getByText('倉庫保管')).toBeVisible();
  await expect(row.getByText('BED-001')).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────
// Test 2: ステータス変更（倉庫保管 → 施設物品）
//
// From 倉庫保管 + 介護保険, allowed: ['介護保険貸与にて使用', '施設物品', '破棄済み']
// '施設物品' requires no client selection → simplest valid transition.
// ────────────────────────────────────────────────────────────────────

test('ステータス変更（倉庫保管 → 施設物品）', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  const itemName = 'テストベッド_変更';
  await registerItem(page, itemName);

  // Change status 倉庫保管 → 施設物品
  await changeStatus(page, itemName, '施設物品');
});

// ────────────────────────────────────────────────────────────────────
// Test 3: 監査ログにエントリが存在する
//
// Create item → 'created' log
// Change status → 'status_changed' log
// ────────────────────────────────────────────────────────────────────

test('監査ログにエントリが存在する', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  const itemName = 'テストベッド_ログ';
  await registerItem(page, itemName);
  await changeStatus(page, itemName, '施設物品');

  // Navigate to 監査ログ tab
  await page.locator('button').filter({ hasText: '監査ログ' }).click();

  // Should show 'created' (from registerItem) and 'status_changed' (from changeStatus)
  // Use .first() because other tests' log entries (created) may also be visible in the table
  await expect(page.getByText('created').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('status_changed').first()).toBeVisible({ timeout: 5_000 });
});

// ────────────────────────────────────────────────────────────────────
// Test 4: セット管理 – セットの新規作成
// ────────────────────────────────────────────────────────────────────

test('セットの新規作成', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  await page.locator('button').filter({ hasText: 'セット管理' }).click();
  await page.locator('button').filter({ hasText: 'セット追加' }).click();
  await expect(page.getByRole('heading', { name: 'セット追加' })).toBeVisible();

  const setName = 'テストセット_E2E';
  await page.getByPlaceholder('例: セットA-001').fill(setName);
  // Save (SetModal button text: "保存")
  await page.locator('button').filter({ hasText: '保存' }).click();

  await expect(page.getByRole('heading', { name: 'セット追加' })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(setName)).toBeVisible({ timeout: 15_000 });
});

// ────────────────────────────────────────────────────────────────────
// Test 5: クリーニング開始（施設物品 → クリーニング前）
//
// From 施設物品 + 介護保険, allowed includes 'クリーニング前' → ボタン表示
// ────────────────────────────────────────────────────────────────────

test('クリーニング開始（施設物品 → クリーニング前）', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  const itemName = 'テストベッド_クリーニング';
  await registerItem(page, itemName);
  // First transition: 倉庫保管 → 施設物品
  await changeStatus(page, itemName, '施設物品');

  // Now item is in 施設物品 + 介護保険
  // getAllowedNextStatuses('施設物品', '介護保険') includes 'クリーニング前' → button appears
  const row = page.locator('tr', { hasText: itemName });
  await row.locator('button').filter({ hasText: 'クリーニング前' }).click();

  await expect(page.getByRole('heading', { name: 'クリーニング前へ' })).toBeVisible();
  await page.getByPlaceholder('クリーニング業者名').fill('テスト業者');
  // Submit (CleaningStartModal button text: "クリーニング前へ")
  await page.locator('button').filter({ hasText: 'クリーニング前へ' }).last().click();

  await expect(page.getByRole('heading', { name: 'クリーニング前へ' })).not.toBeVisible({ timeout: 5_000 });
  await expect(row.getByText('クリーニング前')).toBeVisible({ timeout: 15_000 });
});

// ────────────────────────────────────────────────────────────────────
// Test 6: 機材の削除
// ────────────────────────────────────────────────────────────────────

test('機材の削除', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  const deleteItemName = 'テストベッド_削除';
  await registerItem(page, deleteItemName);

  // Override window.confirm to return true (accept deletion without dialog event issues)
  await page.evaluate(() => { window.confirm = () => true; });

  const row = page.locator('tr', { hasText: deleteItemName });
  await row.locator('button').filter({ hasText: '削除' }).click();

  await expect(page.getByText(deleteItemName)).not.toBeVisible({ timeout: 15_000 });
});

// ────────────────────────────────────────────────────────────────────
// Test 7: Firestore整合性 – ページリロード後もデータが保持される
// ────────────────────────────────────────────────────────────────────

test('Firestore整合性 – ページリロード後にデータが保持される', async ({ page }) => {
  await openApp(page);
  await openEquipmentTracking(page);

  const itemName = 'テストベッド_整合性';
  await registerItem(page, itemName);

  // Verify item exists before reload
  await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

  // Reload the page (simulates browser refresh / navigation away and back)
  await page.reload();
  await expect(page.locator('button', { hasText: '個体管理' }).first())
    .toBeVisible({ timeout: 30_000 });
  await openEquipmentTracking(page);

  // Item should still be there (Firestore persisted across reload)
  await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

  const row = page.locator('tr', { hasText: itemName });
  await expect(row.getByText('倉庫保管')).toBeVisible();
});
