import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../src/exportCsv.js';
const fmt = value => value == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

test('calendar selection shows harmonized comparisons, region, provenance and completeness at desktop and mobile widths', async ({ page, request }) => {
  const bbox = '-64,-28,-59,-24';
  const response = await (await request.get(`/api/anomaly?bbox=${bbox}&month=2026-07&daynight=D`)).json();
  const stats = response.data[0].metrics.harmonized;
  await page.goto('/');
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  const section = page.locator('#explore');
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Explore historical burning activity');
  await expect(section.locator('.explore-context')).toContainText('Gran Chaco');
  await expect(section.locator('.explore-context')).toContainText('January 2003 – October 2026');
  await expect(page.getByLabel('Day or night', { exact: true })).toHaveValue('D');
  await expect(section.getByRole('button', { name: 'Harmonized', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const july = section.getByRole('button', { name: /^Jul 2026:/ });
  await expect(july).toHaveAttribute('title', /Gap-filled estimate from MODIS · MODIS input coverage complete · Raw VIIRS incomplete · Sensor gap flagged/);
  await july.click();
  await expect(section.locator('.anomaly-region')).toHaveText('Gran Chaco · July 2026');
  await expect(section.locator('.comparison strong')).toHaveText([fmt(stats.value), fmt(stats.historical_median), `${stats.difference > 0 ? '+' : ''}${fmt(stats.difference)}`]);
  await expect(section.locator('.anomaly-number')).toHaveText(`${stats.percent_change > 0 ? '+' : ''}${fmt(stats.percent_change)}%`);
  await expect(section.locator('.anomaly-rank')).toContainText(`${stats.rank} of ${stats.rank_count}`);
  await expect(section.locator('.provenance-badges')).toContainText('Gap-filled estimate');
  await section.locator('.baseline-years summary').click();
  await expect(section.locator('.baseline-years p')).toHaveText(stats.baseline_years.join(', '));
  await section.locator('.baseline-years summary').click();
  await expect(section.locator('.baseline-definition')).toContainText('unavailable months and known incomplete observations are excluded');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.getByRole('link', { name: 'Fire History', exact: true }).click();
    await expect.poll(() => section.evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.topbar').getBoundingClientRect().bottom - 16))).toBeLessThan(3);
    const calendar = await section.locator('.calendar-panel').boundingBox();
    const panel = await section.locator('.anomaly-panel').boundingBox();
    if (width > 900) expect(panel.x).toBeGreaterThan(calendar.x + calendar.width);
    else expect(panel.y).toBeGreaterThanOrEqual(calendar.y + calendar.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await section.screenshot({ path: `test-results/history-workspace-${width}.png` });
  }
  const march = section.getByRole('button', { name: /^Mar 2026:/ });
  await expect(march).toHaveAttribute('title', /Observed VIIRS · Incomplete observations/);
  await march.click();
  await expect(section.locator('.anomaly-rank')).toHaveText('Rank withheld');
  await expect(section.locator('.anomaly-number')).toHaveText('—');
  await expect(section.locator('.month-quality')).toContainText('confirmed missing S-NPP days');
  await expect(section.getByRole('button', { name: /^Nov 2026:/ })).toBeDisabled();
  await expect(section.getByRole('button', { name: /^Nov 2026:/ })).toHaveAttribute('title', /Unavailable · Outside selected date range/);
  await page.getByLabel('Day or night', { exact: true }).selectOption('N');
  await section.getByRole('button', { name: /^Jan 2003:/ }).click();
  await expect(section.locator('.comparison strong').first()).toHaveText('—');
  await expect(section.locator('.provenance-badges')).toHaveText('Harmonized value unavailable');
});

test('downloaded CSV contains actual all-sensor values, dates, selection bounds and quality metadata', async ({ page, request }) => {
  const bbox = '-64,-38,-59,-33', start = '2026-03', end = '2026-10';
  const payload = await (await request.get(`/api/series?bbox=${bbox}&start=${start}&end=${end}&daynight=D`)).json();
  expect(payload.synthetic).toBe(false);
  await page.goto('/');
  await page.getByRole('button', { name: 'Pampas', exact: true }).click();
  await page.getByLabel('Start month').fill(start);
  await page.getByLabel('End month').fill(end);
  await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const download = await downloadPromise;
  const [columns, ...rows] = parseCsv(await readFile(await download.path(), 'utf8'));
  expect(rows).toHaveLength(payload.data.length);
  for (const [i, row] of rows.entries()) {
    const actual = Object.fromEntries(columns.map((key, index) => [key, row[index]])), expected = payload.data[i];
    expect(actual.date).toBe(`${expected.year}-${String(expected.month).padStart(2, '0')}`);
    expect(actual.study_area).toBe('Pampas');
    expect([actual.bbox_west, actual.bbox_south, actual.bbox_east, actual.bbox_north].join(',')).toBe(bbox);
    expect(actual.selection_start).toBe(start); expect(actual.selection_end).toBe(end);
    expect(actual.daynight).toBe('D'); expect(actual.synthetic).toBe('false');
    for (const metric of ['harmonized', 'raw_modis', 'raw_viirs']) {
      if (expected[metric] == null) expect(actual[metric]).toBe('');
      else expect(Number(actual[metric])).toBe(expected[metric]);
    }
    expect(actual.source).toBe(expected.source);
    expect(actual.incomplete_metrics).toBe(expected.incomplete_metrics.join(';'));
    expect(actual.gap_flag.toLowerCase()).toBe(String(expected.gap_flag));
    expect(actual.nrt.toLowerCase()).toBe(String(expected.nrt));
  }
});
