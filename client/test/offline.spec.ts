import { expect, test } from '@playwright/test';
import { addItem, createList, rowFor, signIn } from './helpers.ts';

/**
 * The two things that only a browser can prove: a change made with the network
 * cut keeps working, and it lands on the server once the phone is back online.
 */
test('a list can be used with no connection, and the changes arrive afterwards', async ({
  page,
  context,
}) => {
  const name = `Offline ${Math.random().toString(36).slice(2, 7)}`;

  await signIn(page);
  await createList(page, name);
  await addItem(page, 'milk');
  await expect(page.getByTestId('pending-writes')).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();

  // Both a new item and a check-off, while nothing can reach the server.
  await addItem(page, 'bread');
  await rowFor(page, 'milk').getByTestId('item-check').click();
  await expect(rowFor(page, 'milk')).toHaveAttribute('data-checked', 'true');

  // The app still shows everything; nothing has been reported as lost.
  await expect(page.getByTestId('notice')).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  await expect(page.getByTestId('pending-writes')).toHaveCount(0);

  // A fresh load reads the server, so this proves the writes really landed.
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  await expect(rowFor(page, 'bread')).toBeVisible();
  await expect(rowFor(page, 'milk')).toHaveAttribute('data-checked', 'true');
});

test('a queued write against a list that has been deleted is reported, not lost quietly', async ({
  page,
  browser,
}) => {
  const name = `Doomed ${Math.random().toString(36).slice(2, 7)}`;

  await signIn(page);
  await createList(page, name);

  // A second member deletes nothing, but keeps their own copy of the list.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, 'dad@example.com');
  await otherPage.getByRole('button', { name: new RegExp(name) }).click();
  await expect(otherPage.getByTestId('add-item-input')).toBeVisible();

  // Dad goes offline and records something.
  await otherPage.context().setOffline(true);
  await addItem(otherPage, 'sunscreen');

  // Mum is the creator, and deletes the list in the meantime.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('delete-list').click();
  await expect(page.getByTestId('page-title')).toHaveText('Lists');

  // Dad comes back: his write has nowhere to go, and he is told so.
  await otherPage.context().setOffline(false);
  await expect(otherPage.getByTestId('notice')).toBeVisible({ timeout: 20_000 });
  await expect(otherPage.getByTestId('notice')).toContainText('didn\u2019t reach the list');

  await other.close();
});
