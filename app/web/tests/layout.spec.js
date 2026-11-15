import { test, expect } from '@playwright/test';

test('desktop overview is 55/45, lower sections are full width, and row anchors stay usable', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.raw-chart')).toHaveCount(2);
  const box = id => page.locator(`#${id}`).boundingBox();
  const [where, satellites, history, explore] = await Promise.all(['where','satellites','history','explore'].map(box));
  expect(Math.abs(where.y - satellites.y)).toBeLessThan(1);
  expect(where.width / (where.width + satellites.width)).toBeCloseTo(.55, 2);
  expect(satellites.x).toBeGreaterThan(where.x + where.width);
  expect(history.y).toBeGreaterThanOrEqual(Math.max(where.y + where.height, satellites.y + satellites.height));
  expect(history.x).toBeCloseTo(where.x, 0);
  expect(history.width).toBeCloseTo(satellites.x + satellites.width - where.x, 0);
  expect(explore.x).toBeCloseTo(history.x, 0);
  expect(explore.width).toBeCloseTo(history.width, 0);
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
  for (const width of [1024, 390]) {
    await page.setViewportSize({width,height:1000});
    await expect(page.locator('.calendar-scroll')).toHaveAttribute('aria-busy','false');
    const boxes = await Promise.all(['where','satellites','history','explore'].map(id=>page.locator(`#${id}`).boundingBox()));
    for (let i=1;i<boxes.length;i++) {
      expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i-1].y+boxes[i-1].height);
      expect(boxes[i].x).toBeCloseTo(boxes[0].x,0);
      expect(boxes[i].width).toBeCloseTo(boxes[0].width,0);
    }
    await expect(page.locator('.study-area-name')).toHaveText('Gran Chaco');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    // The long mobile page exceeds the software renderer's full-image limit.
    // Capture each section while retaining all page geometry assertions above.
    if (width <= 600) {
      for (const id of ['where','satellites','history','explore']) await page.locator(`#${id}`).screenshot({path:`test-results/analytics-layout-${width}-${id}.png`});
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
