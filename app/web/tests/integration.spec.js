import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../src/exportCsv.js';
const fmt = value => value == null ? '—' : value.toLocaleString('en', { maximumFractionDigits: 1 });

test('presets and custom coordinates propagate identical geography through every analysis and export', async ({ page, request }) => {
  test.setTimeout(90000);
  const meta = await (await request.get('/api/meta')).json();
  expect(meta.synthetic).toBe(false);
  expect(meta.latest_complete_month).toBe('2026-10');
  await page.goto('/');
  await expect(page.locator('.validation-metric > strong').first()).not.toHaveText('—');
  const nationalScores = await page.locator('.validation-metric > strong').allTextContents();
  const regions = [
    ['Gran Chaco', '-64,-28,-59,-24'], ['Pampas', '-64,-38,-59,-33'],
    ['Patagonia', '-71,-50,-67,-40'], ['Custom area', '-63,-27,-61,-25'],
    ['All Argentina', '-74,-56,-53,-21'],
  ];
  for (const [name, bbox] of regions) {
    const params = new URLSearchParams({ bbox, start: meta.start, end: meta.latest_complete_month, daynight: 'D' });
    const [series, area, anomaly] = await Promise.all([
      request.get(`/api/series?${params}`).then(r => r.json()),
      request.get(`/api/area-summary?bbox=${bbox}&daynight=D`).then(r => r.json()),
      request.get(`/api/anomaly?bbox=${bbox}&month=2026-10&daynight=D`).then(r => r.json()),
    ]);
    expect(series.bbox.join(',')).toBe(bbox);
    expect(series.synthetic).toBe(false);
    expect(series.unit).toBe('active cell-days');
    if (name === 'Custom area') {
      await page.locator('.custom-coordinates summary').click();
      const [west, south, east, north] = bbox.split(',');
      for (const [label, value] of [['West longitude', west], ['South latitude', south], ['East longitude', east], ['North latitude', north]]) await page.getByLabel(label).fill(value);
      await page.getByRole('button', { name: 'Update study area', exact: true }).click();
      await page.locator('.custom-coordinates summary').click();
    } else await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.study-area-name')).toHaveText(name);
    await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.raw-chart')).toHaveCount(2);
    const slider = page.getByLabel('Inspect satellite month');
    await slider.focus(); await page.keyboard.press('End');
    const latest = series.data.at(-1);
    await expect(page.locator('.raw-hover strong')).toHaveText([fmt(latest.raw_modis), fmt(latest.raw_viirs)]);
    const max = Math.max(...series.data.flatMap(r => [r.raw_modis ?? 0, r.raw_viirs ?? 0]));
    for (const chart of await page.locator('.raw-chart').all()) await expect(chart).toHaveAttribute('data-y-max', String(max));
    await expect(page.locator('#history .why-panel > .muted')).toContainText(name);
    await expect(page.locator('.validation-metric > strong')).toHaveText(nationalScores);
    const year = area.annual_daytime.find(row => row.year === 2025);
    const point = page.locator('.annual-point[data-series=harmonized][data-year="2025"]');
    await expect(point).toHaveAccessibleName(new RegExp(`Harmonized: ${fmt(year.harmonized).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} active cell-days`));
    await expect(page.locator('.summary strong')).toHaveText(fmt(series.data.reduce((sum, row) => sum + (row.harmonized ?? 0), 0)));
    const october = page.getByRole('button', { name: /^Oct 2026:/ });
    await expect(october).toHaveAttribute('title', `Oct 2026 · ${fmt(latest.harmonized)} active cell-days · Observed VIIRS · Complete observation coverage · NRT · provisional`);
    await october.click();
    await expect(page.locator('.anomaly-region')).toHaveText(`${name} · October 2026`);
    const stats = anomaly.data[0].metrics.harmonized;
    await expect(page.locator('.comparison strong').first()).toHaveText(fmt(stats.value));
    await expect(page.locator('.comparison strong').nth(1)).toHaveText(fmt(stats.historical_median));
    await expect(page.locator('.anomaly-rank')).toContainText(`${stats.rank} of ${stats.rank_count}`);
    await page.getByRole('button', { name: 'Compare seasons', exact: true }).click();
    const spring = series.data.filter(row => row.year === 2025 && [9, 10, 11].includes(row.month));
    expect(spring).toHaveLength(3);
    expect(spring.every(row => !row.incomplete)).toBe(true);
    await expect(page.locator('.season-panel > .muted')).toContainText(name);
    await expect(page.locator('[data-season="spring-2025"]')).toHaveAttribute('data-total', String(spring.reduce((sum, row) => sum + row.harmonized, 0)));
    await page.getByRole('button', { name: 'Fire calendar', exact: true }).click();
    await page.getByLabel('Start month').fill('2025-09');
    await page.getByLabel('End month').fill('2025-11');
    await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy', 'false');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
    const [header, ...rows] = parseCsv(await readFile(await (await downloaded).path(), 'utf8'));
    expect(rows).toHaveLength(3);
    for (const [i, row] of rows.entries()) {
      const record = Object.fromEntries(header.map((key, column) => [key, row[column]]));
      expect(record.study_area).toBe(name);
      expect([record.bbox_west, record.bbox_south, record.bbox_east, record.bbox_north].join(',')).toBe(bbox);
      expect(record.date).toBe(`2025-${String(i + 9).padStart(2, '0')}`);
      expect(record.selection_start).toBe('2025-09'); expect(record.selection_end).toBe('2025-11');
      for (const metric of ['harmonized', 'raw_modis', 'raw_viirs']) expect(Number(record[metric])).toBe(spring[i][metric]);
    }
    await page.getByLabel('Start month').fill(meta.start);
    await page.getByLabel('End month').fill(meta.latest_complete_month);
  }
});
