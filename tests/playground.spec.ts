import { test, expect } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
test('layout renders without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByLabel('JavaScript source')).toBeVisible();
  await expect(page.getByText('output.c', { exact: true })).toBeVisible();
  await expect(page.getByText('Build output', { exact: true })).toBeVisible();
  await expect(page.getByText('stdout', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(os.tmpdir(), 'porfground-desktop.png') });
  expect(errors).toEqual([]);
});
test('real compiler pipeline, edits, diagnostics, and recovery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready', { timeout: 60000 });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Ready', { timeout: 60000 });
  await expect(page.getByLabel('Program stdout')).toBeVisible();
  await expect(page.getByLabel('Program stdout')).toContainText('fibonacci(10) = 55');
  await expect(page.getByLabel('Program stdout')).not.toContainText('warning:');
  await expect(page.getByLabel('Program stdout')).not.toContainText('Process exited');
  await page.screenshot({ path: path.join(os.tmpdir(), 'porfground-desktop.png') });
  await page.getByText('Build output', { exact: true }).click();
  await expect(page.getByLabel('Build and compiler output')).toBeVisible();
  await expect(page.getByLabel('Build and compiler output')).toContainText('warning:');
  await expect(page.getByLabel('Build and compiler output')).toContainText(
    'Process exited with code 0',
  );
  await expect(page.getByLabel('Build and compiler output')).not.toContainText(
    'fibonacci(10) = 55',
  );
  const editor = page.getByLabel('JavaScript source');
  await editor.fill('console.log(6 * 7);');
  await expect(page.getByRole('status')).toHaveText('Ready', { timeout: 60000 });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Program stdout')).toContainText('42', { timeout: 60000 });
  await editor.fill('const = ;');
  await expect(page.getByRole('status')).toHaveText('Compilation failed', { timeout: 60000 });
  await expect(page.getByLabel('Build and compiler output')).toBeVisible();
  await expect(page.getByLabel('Build and compiler output')).toContainText('SyntaxError');
  await editor.fill('console.log("recovered");');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Program stdout')).toContainText('recovered', { timeout: 60000 });
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.reload();
  await expect(editor).toContainText('recovered');
  expect(errors).toEqual([]);
});
test('mobile viewport stays within the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready', { timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: path.join(os.tmpdir(), 'porfground-mobile.png') });
});
test('infinite programs can be stopped and the worker recovers', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready', { timeout: 60000 });
  await page.getByLabel('JavaScript source').fill('while (true) {}');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Running WebAssembly…', { timeout: 60000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByLabel('Build and compiler output')).toContainText('Execution stopped.');
  await page.getByLabel('JavaScript source').fill('console.log("after stop");');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Program stdout')).toContainText('after stop', { timeout: 60000 });
});
