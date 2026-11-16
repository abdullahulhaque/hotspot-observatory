import { test, expect } from '@playwright/test';
import { openTab, openView } from './helpers.js';
// Every number added by the redesign must trace to the API or the committed files.
const fmt = (value, digits = 1) => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);

test('Figure 1 jump and interval come from the national annual record and validation metadata', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const national = await (await request.get('/api/area-summary?bbox=-74,-56,-53,-21&daynight=D')).json();
  const validation = await (await request.get('/api/validation')).json();
  const at = year => national.annual_daytime.find(r => r.year === year);
  const naive = at(2012).naive_splice / at(2011).naive_splice, harmonized = at(2012).harmonized / at(2011).harmonized;
  await page.goto('/?view=about');
  const hero = page.locator('#question');
  await expect(hero.locator('.hero-finding')).toContainText(`${fmt(naive, 2)}×`);
  await expect(hero.locator('.hero-finding')).toContainText(`${fmt(harmonized, 2)}×`);
  const loyo = validation.interval_80.leave_one_year_out;
  await expect(hero.locator('.figure-note-inline')).toContainText(`${Math.round(loyo.annual_test_coverage * validation.interval_80.test_years_n)} of ${validation.interval_80.test_years_n}`);
  await hero.locator('.hit').first().focus();
  const first = national.annual_daytime[0];
  await expect(hero.locator('.readout')).toContainText(`${fmt(first.harmonized * Math.exp(loyo.annual_log_q10_q90[0]), 0)}–${fmt(first.harmonized * Math.exp(loyo.annual_log_q10_q90[1]), 0)}`);
  await expect(hero.locator('.use-cases li')).toHaveCount(3);
  // Each use case opens the matching analysis in the explorer.
  await hero.locator('.use-cases li').nth(2).getByRole('button', { name: 'Open this analysis in Explore' }).click();
  await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Explore' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tablist', { name: 'Analyses' }).getByRole('tab', { name: 'Regions' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('data table periods and method parameters are read from metadata', async ({ page, request }) => {
  const validation = await (await request.get('/api/validation')).json();
  const meta = await (await request.get('/api/meta')).json();
  await page.goto('/?view=data');
  const table = page.locator('.sources-table');
  await expect(table.locator('tbody tr')).toHaveCount(7);
  await expect(table.locator('tbody tr').nth(0)).toContainText(`${validation.acq_date_spans['MODIS 2003'][0]} to ${validation.acq_date_spans['MODIS 2025'][1]}`);
  await expect(table.locator('tbody tr').nth(1)).toContainText(`${validation.acq_date_spans['VIIRS 2012'][0]} to ${validation.acq_date_spans['VIIRS 2025'][1]}`);
  await expect(table.locator('tbody tr').nth(4)).toContainText(`${validation.live_year.snpp_coverage_check.days.length} live-year days checked`);
  await openView(page, 'Methods');
  const method = page.locator('#method');
  await expect(method.locator('.method-steps > li')).toHaveCount(8);
  await expect(method.locator('.equation')).toContainText(fmt(validation.model.a, 4));
  await expect(method.locator('.equation')).toContainText(fmt(validation.model.b, 5));
  await expect(method.locator('.parameters')).toContainText(meta.parameters.coverage);
  await expect(method.locator('.parameters')).toContainText(meta.parameters.contract);
  await expect(method.locator('.method-steps')).toContainText(`${validation.gap_flagged_months.length} flagged months`);
  await expect(method.locator('.assumptions')).toContainText(`${fmt(meta.modelled_cells_exceeding_days.count, 0)} modelled cell-months exceed`);
  const download = page.waitForEvent('download');
  await method.getByRole('button', { name: 'Download parameters (JSON)' }).click();
  const file = await download;
  const record = JSON.parse(await (await import('node:fs/promises')).readFile(await file.path(), 'utf8'));
  expect(record.model.b).toBe(validation.model.b);
  expect(record.data_file.filters).toBe(meta.parameters.filters);
});

test('validation adds the saved model comparison, rebuilt interval and per-year error', async ({ page, request }) => {
  const validation = await (await request.get('/api/validation')).json();
  await page.goto('/?view=validation');
  const section = page.locator('#validation');
  const rows = validation.model_comparison.rows.filter(r => r.split === 'test');
  const table = section.locator('.model-comparison tbody tr');
  await expect(table).toHaveCount(rows.length);
  for (const [i, row] of rows.entries()) await expect(table.nth(i).locator('td').first()).toHaveText(`${fmt(row.monthly_mape, 2)}%`);
  await expect(section.locator('.selected-model')).toContainText('B. Power law');
  // Bold marks the largest R² and smallest |MAPE| among calibrated models.
  const bestAnnualR2 = Math.max(...rows.filter(r => r.model !== 'raw_modis').map(r => r.annual_r2));
  await expect(section.locator('.model-comparison tbody td.best', { hasText: fmt(bestAnnualR2, 3) })).toHaveCount(1);
  const interval = validation.prediction_series.interval;
  await expect(section.locator('.held-out-comparison')).toContainText(`${interval.months_inside} of ${interval.months_scored} scored months fall inside the 80% band`);
  await expect(section.locator('.outside-marker')).toHaveCount(interval.months_scored - interval.months_inside);
  // Annual error, recomputed here from the saved predictions (scored months only).
  const byYear = {};
  for (const row of validation.prediction_series.data.filter(r => r.included)) {
    byYear[row.year] ??= { observed: 0, model: 0 };
    byYear[row.year].observed += row.actual_viirs; byYear[row.year].model += row.model_b;
  }
  const label = await section.locator('.annual-error-chart').getAttribute('aria-label');
  for (const [year, totals] of Object.entries(byYear)) {
    const error = 100 * (totals.model - totals.observed) / totals.observed;
    expect(label).toContain(`${year} ${error > 0 ? '+' : '−'}${fmt(Math.abs(error), 1)}%`);
  }
  await expect(section.locator('.join-check')).toContainText(fmt(validation.join_check_2012.observed_viirs, 0));
  await expect(section.locator('.join-check strong')).toHaveText(validation.join_check_2012.pass ? 'Pass' : 'Fail');
});

test('map layer, anomaly context and regional analyses use real values', async ({ page, request }) => {
  const meta = await (await request.get('/api/meta')).json();
  const grid = await (await request.get(`/api/grid?month=${meta.latest_complete_month}&daynight=D&metric=harmonized`)).json();
  await page.goto('/');
  const map = page.locator('.map-pane');
  await expect(map.locator('.map-stats')).toContainText(`${fmt(grid.count)} active cells`);
  await expect(map.locator('.heat-ticks span').last()).toHaveText(fmt(grid.max));
  const gridLoaded = page.waitForResponse(r => r.url().includes('/grid?') && new URL(r.url()).searchParams.get('month') === '2020-08');
  await page.getByRole('button', { name: /^Aug 2020:/ }).click();
  const august = await (await gridLoaded).json();
  await expect(map.locator('.pane-title')).toContainText('August 2020');
  await expect(page.getByRole('slider', { name: 'Selected month' })).toHaveAttribute('aria-valuetext', new RegExp('^Aug 2020: '));
  await expect(map.locator('.map-stats')).toContainText(`${fmt(august.count)} active cells`);
  // Anomaly screening class: percentile recomputed from the API baseline.
  const anomaly = await (await request.get('/api/anomaly?bbox=-74,-56,-53,-21&month=2020-08&daynight=D')).json();
  const stats = anomaly.data[0].metrics.harmonized;
  const values = stats.history.map(h => h.value);
  const percentile = 100 * (values.filter(v => v < stats.value).length + values.filter(v => v === stats.value).length / 2) / values.length;
  await expect(page.locator('.anomaly-class')).toContainText(`${fmt(percentile, 0)}th percentile of ${values.length} earlier Aug records`);
  await expect(page.locator('.anomaly-disclaimer')).toHaveText('An anomaly is a signal to investigate, not a prediction that a wildfire will occur.');
  await expect(page.locator('.strip-chart circle')).toHaveCount(values.length);
  // Regional peak months, recomputed from each preset's complete years.
  const presets = { 'All Argentina': '-74,-56,-53,-21', 'Gran Chaco': '-64,-28,-59,-24', 'Pampas': '-64,-38,-59,-33', 'Patagonia': '-71,-50,-67,-40' };
  await openTab(page, 'Regions');
  const rows = page.locator('.regional-figure tbody tr');
  await expect(rows).toHaveCount(4);
  for (const [i, [name, bbox]] of Object.entries(presets).entries()) {
    const data = (await (await request.get(`/api/series?bbox=${bbox}&start=${meta.start}&end=${meta.end}&daynight=D`)).json()).data;
    const years = [...new Set(data.map(r => r.year))].filter(y => data.filter(r => r.year === y && r.harmonized != null).length === 12);
    const means = Array.from({ length: 12 }, (_, m) => years.reduce((s, y) => s + data.find(r => r.year === y && r.month === m + 1).harmonized, 0) / years.length);
    const peak = means.indexOf(Math.max(...means));
    await expect(rows.nth(i).locator('th')).toHaveText(name);
    await expect(rows.nth(i).locator('td').first()).toHaveText(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][peak]);
    await expect(rows.nth(i).locator('td').last()).toHaveText(String(years.length));
  }
  await openTab(page, 'Timing & trend');
  await expect(page.locator('.timing-figure .stat-line').first()).toContainText(/Mann–Kendall τ = -?[\d.]+, p (<|=) [\d.]+, n = \d+ years/);
  await page.getByRole('button', { name: 'Patagonia', exact: true }).click();
  await expect(page.locator('.timing-figure .figure-title')).toHaveText('Timing and size of the fire year in Patagonia');
});

test('limitations are generated from metadata and the overpass diagnostics', async ({ page, request }) => {
  const validation = await (await request.get('/api/validation')).json();
  const meta = await (await request.get('/api/meta')).json();
  await page.goto('/?view=limitations');
  const section = page.locator('#limitations');
  await expect(section.locator('.limitations-summary')).toContainText(`${fmt(100 * validation.monthly_interval_coverage, 1)}%`);
  await expect(section.locator('.limitations-summary')).toContainText(`${fmt(meta.modelled_cells_exceeding_days.count, 0)} modelled cell-months in ${meta.modelled_cells_exceeding_days.months} months`);
  const rows = validation.known_limitations.find(l => l.id === 'diagnostic_table').rows.filter(r => r.median_day_local_solar_min != null);
  await expect(section.locator('.overpass-chart circle')).toHaveCount(rows.length);
  await expect(section.locator('.next-steps li')).toHaveCount(5);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('unit notes, same-month comparison and recent baseline trace to the API', async ({ page, request }) => {
  await page.goto('/?month=2020-08');
  // 1. Every headline number has the unit definition beside it.
  const notes = page.locator('.unit-note');
  await expect(notes).toHaveCount(3);
  await expect(page.locator('.controls .unit-note summary')).toHaveText('Active cell-days: satellite-detected fire activity, not a fire count or burned area');
  await page.locator('.inspector .unit-note summary').click();
  await expect(page.locator('.inspector .unit-note-body')).toContainText('One active cell-day is one 0.1° grid cell');
  // 2. The selected month across the last N years, read from /anomaly same_month.
  const all = await (await request.get('/api/anomaly?bbox=-74,-56,-53,-21&month=2020-08&daynight=D')).json();
  const sameMonth = all.data[0].same_month;
  const chart = page.locator('.same-month');
  await expect(chart.locator('.same-month-title')).toHaveText('Aug in the last 10 years');
  await expect(chart.locator('.same-month-bar')).toHaveCount(10);
  await expect(chart.locator('.same-month-bar.selected')).toHaveCount(1);
  const label = await chart.locator('svg').getAttribute('aria-label');
  for (const item of sameMonth.filter(r => r.year > 2010)) expect(label).toContain(`${item.year}: ${fmt(item.value)} active cell-days`);
  await chart.getByRole('button', { name: '20', exact: true }).click();
  await expect(chart.locator('.same-month-bar')).toHaveCount(18); // record starts in 2003
  await expect(chart.locator('.same-month-bar.estimate')).toHaveCount(9); // 2003–2011 back-cast
  // 3. Recent baseline: medians and ranks come from the API's baseline=10 computation.
  const recent = await (await request.get('/api/anomaly?bbox=-74,-56,-53,-21&month=2020-08&daynight=D&baseline=10')).json();
  const stats = recent.data[0].metrics.harmonized;
  const loaded = page.waitForResponse(r => r.url().includes('/anomaly?') && new URL(r.url()).searchParams.get('baseline') === '10');
  await page.getByRole('button', { name: 'Most recent 10 years', exact: true }).click();
  await loaded;
  await expect(page.locator('.comparison strong').nth(1)).toHaveText(fmt(stats.historical_median));
  await expect(page.locator('.anomaly-rank')).toContainText(`${stats.rank} of ${stats.rank_count}`);
  await expect(page.locator('.baseline-definition')).toContainText('the 10 most recent with eligible values');
  const estimates = stats.history.filter(h => h.source !== 'observed').length;
  await expect(page.locator('.baseline-definition')).toContainText(estimates ? `${estimates} of them ${estimates === 1 ? 'is a model estimate' : 'are model estimates'}` : 'All are observed VIIRS values.');
  await expect(page).toHaveURL(/baseline=10/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Most recent 10 years', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.comparison strong').nth(1)).toHaveText(fmt(stats.historical_median));
});
