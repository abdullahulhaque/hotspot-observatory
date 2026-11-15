import { test, expect } from '@playwright/test';

async function expectFullWidthSections(page) {
  const sections = page.locator('main > section.page-section');
  await expect(sections).toHaveCount(4);
  const boxes = await Promise.all(['where','satellites','history','explore'].map(id=>page.locator(`#${id}`).boundingBox()));
  for (let i=1;i<boxes.length;i++) {
    expect(boxes[i].y - boxes[i-1].y - boxes[i-1].height).toBeCloseTo(24, 0);
    expect(boxes[i].x).toBeCloseTo(boxes[0].x, 0);
    expect(boxes[i].width).toBeCloseTo(boxes[0].width, 0);
  }
  const paddings = await sections.evaluateAll(elements=>elements.map(el=>getComputedStyle(el).padding));
  expect(new Set(paddings).size).toBe(1);
}

test('desktop sections are full width, study area is 65/35, and sensor panels are balanced', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.raw-chart')).toHaveCount(2);
  await expectFullWidthSections(page);
  const map = await page.locator('#where .map-container').boundingBox();
  const controls = await page.locator('#where .region-panel').boundingBox();
  expect(map.y).toBeCloseTo(controls.y, 0);
  expect(map.width / (map.width + controls.width)).toBeCloseTo(.65, 2);
  expect(controls.x).toBeGreaterThan(map.x + map.width);
  for (const selector of ['.raw-chart-card']) {
    const cards = page.locator(`#satellites ${selector}`);
    const [modis, viirs] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(modis.y).toBeCloseTo(viirs.y, 0);
    expect(modis.width).toBeCloseTo(viirs.width, 0);
    expect(viirs.x).toBeGreaterThan(modis.x + modis.width);
    expect(modis.width).toBeGreaterThan(500);
  }
  const current = page.locator('.section-nav [aria-current="location"]');
  await expect(current).toHaveText('Study Area');
  await page.getByRole('link',{name:'Compare Sensors',exact:true}).click();
  await expect(current).toHaveText('Compare Sensors');
  await page.getByRole('link',{name:'Study Area',exact:true}).click();
  await expect(current).toHaveText('Study Area');
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'test-results/analytics-layout-desktop.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('tablet and mobile stack all sections in order and retain the region selection', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Gran Chaco',exact:true}).click();
  for (const width of [1024, 820, 390, 320]) {
    await page.setViewportSize({width,height:1000});
    await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy','false');
    await expectFullWidthSections(page);
    const map = await page.locator('#where .map-container').boundingBox();
    const controls = await page.locator('#where .region-panel').boundingBox();
    if (width > 900) {
      expect(map.y).toBeCloseTo(controls.y, 0);
      expect(map.width / (map.width + controls.width)).toBeCloseTo(.65, 2);
    } else {
      expect(controls.y).toBeGreaterThan(map.y + map.height);
      expect(controls.x).toBeCloseTo(map.x, 0);
      expect(controls.width).toBeCloseTo(map.width, 0);
    }
    await expect(page.locator('.study-area-name')).toHaveText('Gran Chaco');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    // The long mobile page exceeds the software renderer's full-image limit.
    // Capture each section while retaining all page geometry assertions above.
    if (width <= 600) {
      for (const id of ['where','satellites','history','explore']) {
        const section = page.locator(`#${id}`);
        // Keep the sticky header above the section instead of across the capture.
        await section.evaluate(el=>window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().height-16,behavior:'instant'}));
        await section.screenshot({path:`test-results/analytics-layout-${width}-${id}.png`});
      }
    } else await page.screenshot({path:`test-results/analytics-layout-${width}.png`,fullPage:true});
  }
});

test('sticky header navigation is reachable and leaves anchor headings visible at every width', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.topbar .section-nav a')).toHaveText(['Study Area','Compare Sensors','Harmonization','Fire History']);
  await expect(page.locator('main .section-nav')).toHaveCount(0);
  await expect(page.locator('.topbar .section-nav [aria-current="location"]')).toHaveText('Study Area');
  await expect(page.locator('.raw-chart')).toHaveCount(2);
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.locator('.topbar .section-nav').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    for (const [name,id] of [['Harmonization','history'],['Fire History','explore'],['Study Area','where'],['Compare Sensors','satellites']]) {
      await page.getByRole('link',{name,exact:true}).click();
      await expect(page.locator('.topbar .section-nav [aria-current="location"]')).toHaveText(name);
      await expect.poll(()=>page.locator(`#${id}`).evaluate(el=>Math.abs(el.getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().bottom-16))).toBeLessThan(3);
      expect(Math.abs((await page.locator('.topbar').boundingBox()).y)).toBeLessThan(1);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await expect(page.locator('.topbar .section-nav [aria-current="location"]')).toHaveText('Study Area');
    await page.screenshot({path:`test-results/sticky-header-${width}.png`});
  }
});
