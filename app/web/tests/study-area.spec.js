import { test, expect } from '@playwright/test';
import { openTab, openView } from './helpers.js';

for (const width of [1440, 390]) {
  test(`study-area selection, map controls and keyboard coordinates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.locator('.timeline-track')).toBeVisible();
    const section = page.locator('.workspace');
    const presets = section.locator('.presets');
    const draw = section.getByRole('button', { name: 'Select area on map', exact: true });
    const canvas = section.locator('.maplibregl-canvas');
    await expect(presets.locator('[aria-pressed=true]')).toHaveText('All Argentina');
    await expect(section.locator('.coverage-note')).toContainText('only cells inside Argentina are counted');
    await expect(section.locator('.small-area-warning')).toContainText('Regional estimates have not been independently validated');
    await expect(section.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');

    // Zooming, panning and cancelling a rectangle must not change the analysis area.
    await section.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await section.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await draw.click();
    await expect(section.getByRole('button', { name: 'Cancel drawing' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(draw).toHaveAttribute('aria-pressed', 'false');
    await expect(section.locator('.study-area-name')).toHaveText('All Argentina');

    // Presets remain keyboard-operable and refit before a custom rectangle is drawn.
    await presets.getByRole('button', { name: 'Pampas', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(section.locator('.study-area-name')).toHaveText('Pampas');
    await draw.click();
    await canvas.scrollIntoViewIfNeeded();
    const rect = await canvas.boundingBox();
    const response = page.waitForResponse(r => r.url().includes('/area-summary?') && new URL(r.url()).searchParams.get('bbox') !== '-64,-38,-59,-33');
    await page.mouse.move(rect.x + rect.width * .35, rect.y + rect.height * .35);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .65, rect.y + rect.height * .65, { steps: 8 });
    await page.mouse.up();
    const selected = (await response).url();
    await expect(section.locator('.study-area-name')).toHaveText('Custom area');
    await expect(presets.locator('[aria-pressed=true]')).toHaveCount(0);
    const bounds = new URL(selected).searchParams.get('bbox').split(',').map(Number);
    expect(bounds[0]).toBeLessThan(bounds[2]);
    expect(bounds[1]).toBeLessThan(bounds[3]);
    expect(bounds.every(value => value < 0)).toBe(true);

    await section.locator('.custom-coordinates summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('West longitude')).toHaveValue(String(bounds[0]));
    await expect(section.locator('.coordinate-input span')).toHaveText(['°', '°', '°', '°']);
    for (const [label, value] of [['West longitude', '-64'], ['South latitude', '-28'], ['East longitude', '-59'], ['North latitude', '-24']]) {
      await page.getByLabel(label).fill(value);
    }
    const updated = page.waitForResponse(r => r.url().includes('/area-summary?') && new URL(r.url()).searchParams.get('bbox') === '-64,-28,-59,-24');
    await section.getByRole('button', { name: 'Update study area' }).focus();
    await page.keyboard.press('Enter');
    expect((await updated).ok()).toBe(true);
    await expect(section.locator('.study-area-name')).toHaveText('Gran Chaco');
    await expect(presets.locator('[aria-pressed=true]')).toHaveText('Gran Chaco');
    await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await section.screenshot({ path: `test-results/study-area-controls-${width}.png` });
  });
}
