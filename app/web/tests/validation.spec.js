import { test, expect } from '@playwright/test';
const fmt = value => value == null ? '—' : value.toLocaleString('en', { maximumFractionDigits: 2 });
const activity = value => value == null ? 'Unavailable' : value.toLocaleString('en', { maximumFractionDigits: 1 });

test('national validation, baseline, periods and interval coverage come from metadata', async ({ page, request }) => {
  const validation = await (await request.get('/api/validation')).json();
  const score = validation.metrics.find(m => m.name === 'Monthly MAPE');
  expect(score.model_a).toBeGreaterThan(0);
  await page.goto('/');
  const section = page.locator('#history');
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Making satellite observations comparable');
  await expect(section.locator('.validation-metric > strong')).toHaveText([`${fmt(score.raw_modis)}%`, `${fmt(score.harmonized)}%`]);
  await expect(section.locator('.baseline-comparison strong')).toHaveText(`${fmt(score.model_a)}%`);
  await expect(section.locator('.validation-periods')).toContainText('Calibration: 2012–2019 · Held-out validation: 2020–2025');
  await expect(section.locator('.validation-reference')).toContainText('VIIRS is the reference instrument, not independent wildfire ground truth');
  await expect(section.locator('.interval-coverage')).toContainText(`${fmt(100 * validation.monthly_interval_coverage)}%`);
  await expect(section.locator('.interval-coverage')).toContainText('undercovered observations');
  await expect(section.locator('.drift-notice')).toContainText('do not prove that timing changes caused the deterioration');
  for (const [i, period] of validation.periods.entries()) {
    const monthly = period.metrics.find(m => m.name === 'Monthly MAPE');
    await expect(section.locator('.compact-scores tbody tr').nth(i).locator('td')).toHaveText([fmt(monthly.raw_modis), fmt(monthly.model_a), fmt(monthly.harmonized)]);
  }
  await expect(section.locator('.annual-join')).toHaveText('2012: instrument transition');
  await expect(section).not.toContainText('artificial sensor jump');
  await expect(section).toContainText('never the sum of both sensors');
  await expect(section.locator('.scientific-method h4')).toHaveText(['Hypothesis', 'Method', 'Validation', 'Conclusion']);
  await expect(section.locator('.annual-point[data-series=harmonized][data-year="2003"]')).toHaveAccessibleName(/12 MODIS-based back-cast months/);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.getByRole('link', { name: 'Harmonization', exact: true }).click();
    await expect.poll(() => section.evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.topbar').getBoundingClientRect().bottom - 16))).toBeLessThan(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await section.locator('.compact-scores').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await section.screenshot({ path: `test-results/validation-${width}.png` });
  }
});

test('regional history retains actual totals, month provenance and interval bounds while validation stays national', async ({ page, request }) => {
  const meta = await (await request.get('/api/meta')).json();
  const bbox = '-64,-28,-59,-24';
  const series = await (await request.get(`/api/series?bbox=${bbox}&start=${meta.start}&end=${meta.end}&daynight=D`)).json();
  const summary = await (await request.get(`/api/area-summary?bbox=${bbox}&daynight=D`)).json();
  await page.goto('/');
  const section = page.locator('#history');
  await expect(section.locator('.validation-metric > strong').first()).not.toHaveText('—');
  const nationalScores = await section.locator('.validation-metric > strong').allTextContents();
  const loaded = page.waitForResponse(r => r.url().includes('/area-summary?') && new URL(r.url()).searchParams.get('bbox') === bbox);
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  await loaded;
  await expect(section.locator('.why-panel > .muted')).toContainText('Gran Chaco');
  await expect(section.locator('.validation-metric > strong')).toHaveText(nationalScores);
  await expect(section.locator('.validation-reference')).toContainText('national scores do not establish accuracy for arbitrary regional selections');
  await section.locator('.annual-details summary').click();
  const year = summary.annual_daytime.find(row => row.year === 2024);
  const annualRow = section.locator('.annual-details tbody tr').filter({ has: page.getByRole('rowheader', { name: /^2024/ }) });
  await expect(annualRow.locator('td').nth(0)).toHaveText(activity(year.naive_splice));
  await expect(annualRow.locator('td').nth(1)).toHaveText(activity(year.harmonized));
  await expect(annualRow).toContainText('MODIS-based gap-fill');
  const partial = section.locator('.annual-details tbody tr').filter({ has: page.getByRole('rowheader', { name: /^2026/ }) });
  await expect(partial).toContainText('Not plotted');
  await expect(partial).toContainText('Incomplete observations');
  await expect(partial).toContainText('NRT · provisional');
  await expect(section.locator('.annual-point[data-year="2026"]')).toHaveCount(0);
  await section.locator('.monthly-interval-details summary').click();
  const july = series.data.find(row => row.year === 2026 && row.month === 7);
  const interval = section.locator('.monthly-interval-details tbody tr').filter({ has: page.getByRole('rowheader', { name: '2026-07', exact: true }) });
  await expect(interval.locator('td')).toHaveText([activity(july.harmonized), activity(july.lo80), activity(july.hi80), 'Gap-filled estimate · Sensor gap flagged']);
  await expect(section.locator('.monthly-interval-details')).toContainText('Regional coverage has not been independently validated');
});

test('changed and missing metadata never produce fixed scores or an unsupported improvement claim', async ({ page }) => {
  await page.route('**/api/validation', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, model: { train_years: [2014, 2015, 2016] }, test_years: [2021, 2022], monthly_interval_coverage: .9,
      metrics: [{ name: 'Monthly MAPE', unit: '%', raw_modis: 20, harmonized: 30, model_a: 35 }] } });
  });
  await page.goto('/');
  const section = page.locator('#history');
  await expect(section.locator('.validation-metric > strong')).toHaveText(['20%', '30%']);
  await expect(section.locator('.baseline-comparison strong')).toHaveText('35%');
  await expect(section.locator('.validation-periods')).toContainText('2014–2016');
  await expect(section.locator('.validation-periods')).toContainText('2021–2022');
  await expect(section.locator('.validation-conclusion')).toContainText('10 percentage points higher');
  await expect(section.locator('.interval-coverage')).not.toContainText('undercovered observations');
  await page.unroute('**/api/validation');
  await page.route('**/api/validation', route => route.fulfill({ json: { status: 'ready', metrics: [], periods: [], known_limitations: [] } }));
  await page.reload();
  await expect(section.locator('.validation-metric > strong')).toHaveText(['—', '—']);
  await expect(section.locator('.baseline-comparison strong')).toHaveText('—');
  await expect(section.locator('.baseline-comparison')).toContainText('Not reported');
  await expect(section.locator('.validation-conclusion')).toContainText('will appear when validation scores are available');
  await expect(section.locator('.interval-coverage')).toContainText('not reported');
});
