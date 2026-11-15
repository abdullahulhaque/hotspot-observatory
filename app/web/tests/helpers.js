import { expect } from '@playwright/test';

// Top-level views (Explore, Validation, Methods, Data, Limitations, About).
export async function openView(page, name) {
  const tab = page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

// Analysis tabs inside the Explore workspace.
export async function openTab(page, name) {
  const tab = page.getByRole('tablist', { name: 'Analyses' }).getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
