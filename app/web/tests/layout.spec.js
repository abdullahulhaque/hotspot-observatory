import { test, expect } from '@playwright/test';
import { openTab, openView } from './helpers.js';
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('desktop workspace keeps controls, map stage and inspector in one viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.timeline-track')).toBeVisible();
  const [controls, stage, inspector] = await Promise.all(['.controls', '.stage', '.inspector'].map(s => page.locator(s).boundingBox()));
  expect(controls.y).toBeCloseTo(stage.y, 0);
  expect(inspector.y).toBeCloseTo(stage.y, 0);
  expect(stage.x).toBeGreaterThanOrEqual(controls.x + controls.width - 0.5);
  expect(inspector.x).toBeGreaterThanOrEqual(stage.x + stage.width - 0.5);
  // The application fills the viewport; columns scroll internally instead of the page.
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  expect(await page.locator('.stage').evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
  const map = await page.locator('.map-container').boundingBox();
  expect(map.height).toBeGreaterThan(300);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: 'test-results/workspace-1440.png' });
});

test('tablet and phone widths stack the workspace and retain the study area', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  for (const width of [1100, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy', 'false');
    const [controls, stage, inspector] = await Promise.all(['.controls', '.stage', '.inspector'].map(s => page.locator(s).boundingBox()));
    if (width > 900) {
      expect(stage.x).toBeGreaterThanOrEqual(controls.x + controls.width - 0.5);
      expect(inspector.y).toBeGreaterThanOrEqual(stage.y + stage.height - 0.5);
    } else {
      expect(inspector.y).toBeGreaterThanOrEqual(stage.y + stage.height - 0.5);
      expect(controls.y).toBeGreaterThanOrEqual(inspector.y + inspector.height - 0.5);
      expect(controls.x).toBeCloseTo(stage.x, 0);
    }
    await expect(page.locator('.study-area-name')).toHaveText('Gran Chaco');
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await page.getByRole('tablist', { name: 'Views' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/workspace-${width}.png` });
  }
});

test('tabs, timeline and deep links are keyboard operable and reproducible', async ({ page }) => {
  await page.goto('/');
  const views = page.getByRole('tablist', { name: 'Views' });
  await expect(views.getByRole('tab', { name: 'Explore' })).toHaveAttribute('aria-selected', 'true');
  await views.getByRole('tab', { name: 'Explore' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(views.getByRole('tab', { name: 'Validation' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/view=validation/);
  await openView(page, 'Explore');
  await openTab(page, 'Seasons');
  await expect(page).toHaveURL(/tab=seasons/);
  // Timeline: arrows step one month, Page Down one year, Home the first month.
  const slider = page.getByRole('slider', { name: 'Selected month' });
  await expect(page.locator('.month-pill')).toHaveText('2026-10');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.month-pill')).toHaveText('2026-09');
  await page.keyboard.press('PageDown');
  await expect(page.locator('.month-pill')).toHaveText('2025-09');
  await expect(page).toHaveURL(/month=2025-09/);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.locator('.month-pill')).toHaveText('2025-10');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.month-pill')).toHaveText('2003-01');
  // A shared link restores area, analysis tab, month, acquisition and series.
  await page.goto('/?view=explore&tab=trend&bbox=-64,-28,-59,-24&month=2024-08&period=N&series=raw_viirs');
  await expect(page.locator('.study-area-name')).toHaveText('Gran Chaco');
  await expect(page.getByRole('tablist', { name: 'Analyses' }).getByRole('tab', { name: 'Timing & trend' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.month-pill')).toHaveText('2024-08');
  await expect(page.getByLabel('Day or night')).toHaveValue('N');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Raw sensor')).toHaveValue('raw_viirs');
  await expect(page.locator('.map-pane .pane-title')).toContainText('VIIRS Suomi-NPP active cell-days per 0.1° cell, August 2024, nighttime');
  // Invalid parameters fall back to defaults rather than failing.
  await page.goto('/?bbox=1,2,3&month=2024-13&view=nowhere');
  await expect(page.locator('.study-area-name')).toHaveText('All Argentina');
  await expect(page.locator('.month-pill')).toHaveText('2026-10');
  await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Explore' })).toHaveAttribute('aria-selected', 'true');
});
