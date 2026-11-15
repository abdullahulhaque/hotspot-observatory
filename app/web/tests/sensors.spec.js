import { test, expect } from '@playwright/test';
const fmt = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

test('overlap defaults, full history and selected-month raw comparisons retain actual values and quality warnings', async ({ page, request }) => {
  const meta = await (await request.get('/api/meta')).json();
  const params = new URLSearchParams({ bbox: '-64,-28,-59,-24', start: meta.start, end: meta.end, daynight: 'D' });
  const data = (await (await request.get(`/api/series?${params}`)).json()).data;
  await page.goto('/');
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  const section = page.locator('#satellites'), panel = section.locator('.observation-comparison');
  const range = page.getByLabel('Sensor comparison range'), slider = page.getByLabel('Inspect satellite month');
  await expect(range).toHaveValue('overlap');
  await expect(panel).toContainText('Gran Chaco');
  const overlap = data.filter(row => row.year >= 2012);
  await expect(slider).toHaveAttribute('max', String(overlap.length - 1));
  const maximum = Math.max(1, ...overlap.flatMap(row => [row.raw_modis, row.raw_viirs]).filter(v => v != null));
  for (const chart of await section.locator('.raw-chart').all()) {
    await expect(chart).toHaveAttribute('data-y-max', String(maximum));
    await expect(chart).toContainText('2012');
    await expect(chart).not.toContainText('2003');
  }
  for (const date of ['2025-10', '2026-10', '2026-03', '2026-07']) {
    const index = overlap.findIndex(row => `${row.year}-${String(row.month).padStart(2, '0')}` === date);
    const row = overlap[index];
    await slider.fill(String(index));
    await expect(panel.locator('.observation-context')).toHaveText(`Gran Chaco · ${date} · Daytime`);
    await expect(panel.locator('[data-metric=raw_modis]')).toHaveText(fmt(row.raw_modis));
    await expect(panel.locator('[data-metric=raw_viirs]')).toHaveText(fmt(row.raw_viirs));
    if (date === '2026-03' || date === '2026-07') {
      await expect(panel).toContainText('Incomplete observations');
      await expect(panel.locator('[data-metric=difference]')).toHaveText('Unavailable');
      await expect(panel.locator('[data-metric=ratio]')).toHaveText('Unavailable');
      await expect(panel).toContainText('difference and ratio are withheld');
    } else {
      await expect(panel.locator('[data-metric=difference]')).toHaveText(new Intl.NumberFormat('en', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(row.raw_viirs - row.raw_modis));
      await expect(panel.locator('[data-metric=ratio]')).toHaveText(`${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(row.raw_viirs / row.raw_modis)}×`);
    }
    if (row.nrt) await expect(panel).toContainText('provisional NRT');
  }
  const chart = section.locator('.raw-chart').first();
  await chart.scrollIntoViewIfNeeded();
  const rect = await chart.boundingBox();
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5);
  const hovered = await chart.locator('.chart-cursor').getAttribute('data-month');
  await expect(panel.locator('.observation-context')).toContainText(hovered);
  await range.selectOption('full');
  await expect(slider).toHaveAttribute('max', String(data.length - 1));
  await slider.focus(); await page.keyboard.press('Home');
  await expect(panel.locator('[data-metric=raw_modis]')).toHaveText(fmt(data[0].raw_modis));
  await expect(panel.locator('[data-metric=raw_viirs]')).toHaveText('Unavailable');
  await expect(panel).toContainText('Missing / unavailable');
  await expect(panel.locator('[data-metric=ratio]')).toHaveText('Unavailable');
  await range.selectOption('overlap');
  await expect(panel.locator('.observation-context')).toContainText(meta.end);
  await expect(panel).toContainText('do not measure unique wildfires');
});

test('compact instrument table replaces specification cards and preserves responsive paired charts', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('#satellites');
  await expect(section.locator('.raw-chart')).toHaveCount(2);
  const table = section.getByRole('table', { name: 'Instrument comparison' });
  await expect(table.getByRole('columnheader')).toHaveText(['Instrument', 'MODIS Aqua', 'VIIRS S-NPP']);
  await expect(table.getByRole('rowheader')).toHaveText(['Historical coverage in our dataset', 'Nominal active-fire pixel resolution', 'Relative detection sensitivity']);
  await expect(table.getByRole('cell')).toHaveText(['2003 onward', '2012 onward', '≈ 1 km', '≈ 375 m', 'Less sensitive to small hotspots', 'More sensitive to small hotspots']);
  await expect(section.locator('.sensor-overview-card, .pixel-footprint')).toHaveCount(0);
  await expect(section.locator('.sensor-explanation')).toContainText('observation timing');
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    const [left, right] = await Promise.all([0, 1].map(i => section.locator('.raw-chart-card').nth(i).boundingBox()));
    expect(left.width).toBeCloseTo(right.width, 0);
    if (width > 600) {
      expect(left.y).toBeCloseTo(right.y, 0);
      expect(right.x).toBeGreaterThan(left.x + left.width);
    } else expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await table.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('link', { name: 'Compare Sensors', exact: true }).click();
    await expect.poll(() => section.evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.topbar').getBoundingClientRect().bottom - 16))).toBeLessThan(3);
    await section.screenshot({ path: `test-results/sensor-comparison-${width}.png` });
  }
});

test('night raw observations use actual regional data, shared axes, linked month and quality flags without changing Explore', async ({ page, request }) => {
  const meta = await (await request.get('/api/meta')).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  await page.getByLabel('Sensor comparison range').selectOption('full');
  const section = page.locator('#satellites');
  await expect(section.locator('.sensor-observation-controls')).toContainText('Gran Chaco');
  const loaded = page.waitForResponse(r => r.url().includes('/series?') && new URL(r.url()).searchParams.get('daynight') === 'N' && new URL(r.url()).searchParams.get('bbox') === '-64,-28,-59,-24');
  await page.getByLabel('Sensor observation period').selectOption('N');
  const data = (await (await loaded).json()).data;
  const maximum = Math.max(1, ...data.flatMap(r => [r.raw_modis, r.raw_viirs]).filter(v => v != null));
  const charts = section.locator('.raw-chart');
  await expect(charts).toHaveCount(2);
  for (const chart of await charts.all()) {
    await expect(chart).toHaveAttribute('data-y-max', String(maximum));
    await expect(chart).toHaveAccessibleName(/monthly nighttime active cell-days/);
  }
  await expect(page.getByLabel('Day or night', { exact: true })).toHaveValue('D');
  await expect(page.getByLabel('End month')).toHaveValue(meta.latest_complete_month || meta.end);
  const slider = page.getByLabel('Inspect satellite month');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(section.locator('.raw-hover strong')).toHaveText([fmt(data[0].raw_modis), 'Unavailable']);
  // Before VIIRS began there must be no zero-valued line segment.
  const firstViirs = data.findIndex(row => row.raw_viirs != null);
  const firstX = await charts.nth(1).evaluate((svg, i) => {
    const w = svg.viewBox.baseVal.width;
    return 40 + i / (document.querySelector('#satellites input[type=range]').max) * (w - 52);
  }, firstViirs);
  const path = await charts.nth(1).locator('.raw-line').getAttribute('d');
  expect(Number(path.trim().match(/^M([\d.]+)/)[1])).toBeCloseTo(firstX, 4);
  const julyIndex = data.findIndex(r => r.year === 2026 && r.month === 7);
  await slider.fill(String(julyIndex));
  await expect(section.locator('.chart-cursor')).toHaveCount(2);
  for (const cursor of await section.locator('.chart-cursor').all()) await expect(cursor).toHaveAttribute('data-month', '2026-07');
  await expect(section.locator('.raw-hover strong')).toHaveText([fmt(data[julyIndex].raw_modis), fmt(data[julyIndex].raw_viirs)]);
  await expect(section.locator('.raw-hover').nth(1)).toContainText('Incomplete observations');
  const regional = page.waitForResponse(r => r.url().includes('/series?') && new URL(r.url()).searchParams.get('daynight') === 'N' && new URL(r.url()).searchParams.get('bbox') === '-71,-50,-67,-40');
  await page.getByRole('button', { name: 'Patagonia', exact: true }).click();
  const regionData = (await (await regional).json()).data;
  await expect(section.locator('.raw-hover strong')).toHaveText([fmt(regionData[julyIndex].raw_modis), fmt(regionData[julyIndex].raw_viirs)]);
  await page.getByLabel('Sensor observation period').selectOption('D');
  await expect(charts.first()).toHaveAccessibleName(/monthly daytime active cell-days/);
  await expect(page.getByLabel('Day or night', { exact: true })).toHaveValue('D');
});
