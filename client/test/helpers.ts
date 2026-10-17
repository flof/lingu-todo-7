import { expect, type Page } from '@playwright/test';

/** Signs in the way a person does, through the form. */
export async function signIn(page: Page, email = 'mum@example.com'): Promise<void> {
  await page.goto('/');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('correct horse');
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('page-title')).toHaveText('Lists');
}

/** Creates a list and lands on it. */
export async function createList(page: Page, name: string, emoji = '🛒'): Promise<void> {
  await page.getByTestId('new-list-name').fill(name);
  await page.getByRole('button', { name: emoji }).click();
  await page.getByTestId('create-list').click();
  await expect(page.getByTestId('add-item-input')).toBeVisible();
}

export async function addItem(page: Page, text: string): Promise<void> {
  await page.getByTestId('add-item-input').fill(text);
  await page.getByTestId('add-item').click();
  await expect(page.getByTestId('item-row').filter({ hasText: text }).first()).toBeVisible();
}

/** The item texts in the order they are drawn, top to bottom. */
export async function itemOrder(page: Page): Promise<string[]> {
  return page.getByTestId('item-row').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-text') ?? ''),
  );
}

export function rowFor(page: Page, text: string) {
  return page.getByTestId('item-row').filter({ hasText: text }).first();
}
