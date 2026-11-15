import { test, expect } from '@playwright/test';
import { openTab, openView } from './helpers.js';
const fmt = value => value == null ? '—' : value.toLocaleString('en', { maximumFractionDigits: 2 });
const activity = value => value == null ? 'Unavailable' : value.toLocaleString('en', { maximumFractionDigits: 1 });

test('national validation, baseline, periods and interval coverage come from metadata', async ({ page, request }) => {
  const validation = await (await request.get('/api/validation')).json();
  const score = validation.metrics.find(m => m.name === 'Monthly MAPE');
  expect(score.model_a).toBeGreaterThan(0);
  await page.goto('/?view=validation');
  const section = page.locator('#validation'), history = page.locator('#history');
  await expect(section.getByRole('heading', { level: 1 })).toHaveText('Testing the calibration on years it never saw');
  await expect(section.locator('.validation-metric > strong')).toHaveText([`${fmt(score.raw_modis)}%`, `${fmt(score.model_a)}%`, `${fmt(score.harmonized)}%`]);
  const bars = section.locator('.validation-error-track > span');
  const widths = await bars.evaluateAll(elements => elements.map(el => parseFloat(el.style.width)));
  expect(widths[0] / widths[2]).toBeCloseTo(score.raw_modis / score.harmonized, 4);
  expect(widths[1] / widths[2]).toBeCloseTo(score.model_a / score.harmonized, 4);
  await expect(section.locator('.validation-details')).not.toHaveAttribute('open', '');
  await expect(section.locator('.compact-scores')).not.toBeVisible();
  await expect(section.locator('.baseline-comparison strong')).toHaveText(`${fmt(score.model_a)}%`);
  await expect(section.locator('.validation-periods')).toContainText('Calibration: 2012–2019 · Held-out validation: 2020–2025');
  await expect(section.locator('.validation-reference')).toContainText('VIIRS is the reference instrument, not independent wildfire ground truth');
  await expect(section.locator('.interval-coverage')).toContainText(`${fmt(100 * validation.monthly_interval_coverage)}%`);
  await expect(section.locator('.interval-coverage')).toContainText('undercovered observations');
  for (const [i, period] of validation.periods.entries()) {
    const monthly = period.metrics.find(m => m.name === 'Monthly MAPE');
    await expect(section.locator('.compact-scores tbody tr').nth(i).locator('td')).toHaveText([fmt(monthly.raw_modis), fmt(monthly.model_a), fmt(monthly.harmonized)]);
  }
  await expect(section).not.toContainText('artificial sensor jump');
  await expect(section.locator('.scientific-method h4')).toHaveText(['Hypothesis', 'Method', 'Validation', 'Conclusion']);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await section.getByText('Technical validation details', { exact: true }).click();
    await expect(section.locator('.compact-scores')).toBeVisible();
    expect(await section.locator('.compact-scores').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await section.getByText('Technical validation details', { exact: true }).click();
    await section.screenshot({ path: `test-results/validation-${width}.png` });
  }
  await openView(page, 'Limitations');
  await expect(page.locator('#limitations .drift-notice')).toContainText('do not prove that timing changes caused the deterioration');
  await openView(page, 'Explore');
  await openTab(page, 'Annual record');
  await expect(history.locator('.annual-join')).toHaveText('2012: instrument transition');
  await expect(history).toContainText('never the sum of both sensors');
  await expect(history.locator('.annual-point[data-series=harmonized][data-year="2003"]')).toHaveAccessibleName(/12 MODIS-based back-cast months/);
});

test('regional history retains actual totals, month provenance and interval bounds while validation stays national', async ({ page, request }) => {
  const meta = await (await request.get('/api/meta')).json();
  const bbox = '-64,-28,-59,-24';
  const series = await (await request.get(`/api/series?bbox=${bbox}&start=${meta.start}&end=${meta.end}&daynight=D`)).json();
  const summary = await (await request.get(`/api/area-summary?bbox=${bbox}&daynight=D`)).json();
  await page.goto('/?view=validation');
  const validationSection = page.locator('#validation'), section = page.locator('#history');
  await expect(validationSection.locator('.validation-metric > strong').first()).not.toHaveText('—');
  const nationalScores = await validationSection.locator('.validation-metric > strong').allTextContents();
  await openView(page, 'Explore');
  await openTab(page, 'Annual record');
  const loaded = page.waitForResponse(r => r.url().includes('/area-summary?') && new URL(r.url()).searchParams.get('bbox') === bbox);
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  await loaded;
  await expect(section.locator('.why-panel > .muted')).toContainText('Gran Chaco');
  await openView(page, 'Validation');
  await expect(validationSection.locator('.validation-metric > strong')).toHaveText(nationalScores);
  await expect(validationSection.locator('.validation-reference')).toContainText('national scores do not establish accuracy for arbitrary regional selections');
  await openView(page, 'Explore');
  await openTab(page, 'Annual record');
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
  await page.goto('/?view=validation');
  const section = page.locator('#validation');
  await expect(section.locator('.validation-metric > strong')).toHaveText(['20%', '35%', '30%']);
  await expect(section.locator('.baseline-comparison strong')).toHaveText('35%');
  await expect(section.locator('.validation-periods')).toContainText('2014–2016');
  await expect(section.locator('.validation-periods')).toContainText('2021–2022');
  await expect(section.locator('.validation-conclusion')).toContainText('10 percentage points higher');
  await expect(section.locator('.interval-coverage')).not.toContainText('undercovered observations');
  await page.unroute('**/api/validation');
  await page.route('**/api/validation', route => route.fulfill({ json: { status: 'ready', metrics: [], periods: [], known_limitations: [] } }));
  await page.reload();
  await expect(section.locator('.validation-metric > strong')).toHaveText(['—', '—', '—']);
  await expect(section.locator('.baseline-comparison strong')).toHaveText('—');
  await expect(section.locator('.baseline-comparison')).toContainText('Not reported');
  await expect(section.locator('.validation-conclusion')).toContainText('will appear when validation scores are available');
  await expect(section.locator('.interval-coverage')).toContainText('not reported');
  await expect(section.locator('.held-out-chart')).toHaveCount(0);
  await expect(section.locator('.held-out-comparison')).toContainText('not available');
});

test('saved held-out predictions match the national artifact, retain excluded months and precede regional history', async ({ page, request }) => {
  const validation = await (await request.get('/api/validation')).json();
  expect(validation.prediction_series.status).toBe('ready');
  const rows = validation.prediction_series.data;
  await page.goto('/?view=validation');
  const section = page.locator('#validation');
  await expect(section.locator('.held-out-chart')).toBeVisible();
  const slider = page.getByLabel('Inspect validation month');
  await expect(slider).toHaveAttribute('max', String(rows.length - 1));
  for (const date of [[2020, 1], [2022, 7], [2025, 12]]) {
    const index = rows.findIndex(row => row.year === date[0] && row.month === date[1]);
    const row = rows[index];
    await slider.fill(String(index));
    await expect(section.locator('.held-out-values [data-metric=actual_viirs]')).toHaveText(activity(row.actual_viirs));
    await expect(section.locator('.held-out-values [data-metric=model_b]')).toHaveText(activity(row.model_b));
    await expect(section.locator('.held-out-values')).toContainText(row.included ? 'Included in validation' : 'Excluded from validation');
    if (row.gap_flag) await expect(section.locator('.held-out-values')).toContainText('Sensor gap flagged');
  }
  await expect(section.locator('.held-out-excluded')).toHaveCount(rows.filter(row => !row.included).length * 2);
  const original = await section.locator('.held-out-line.model_b').getAttribute('d');
  await openView(page, 'Explore');
  await openTab(page, 'Annual record');
  await page.getByRole('button', { name: 'Gran Chaco', exact: true }).click();
  await expect(page.locator('#history .why-panel > .muted')).toContainText('Gran Chaco');
  await openView(page, 'Validation');
  await expect(section.locator('.held-out-scope')).toContainText('All Argentina');
  await expect(section.locator('.held-out-line.model_b')).toHaveAttribute('d', original);
  await slider.focus(); await page.keyboard.press('Home');
  await expect(section.locator('.held-out-values')).toContainText('2020-01');
  await openView(page, 'Limitations');
  await expect(page.locator('#limitations .limitations-summary')).toBeVisible();
});
