import { expect, test } from '@playwright/test';
import { addItem, createList, itemOrder, rowFor, signIn } from './helpers.ts';

/**
 * Every test shares one household on one server, so each one names its lists
 * uniquely and works only inside them.
 */
function unique(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 7)}`;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('a checked item stays put for five seconds, then sinks greyed to the bottom', async ({
  page,
}) => {
  await createList(page, unique('Groceries'));
  await addItem(page, 'milk');
  await addItem(page, 'bread');
  await addItem(page, 'butter');

  // Newest at the top.
  expect(await itemOrder(page)).toEqual(['butter', 'bread', 'milk']);

  await rowFor(page, 'butter').getByTestId('item-check').click();

  // Still where it was: someone in the shop might tap it again to undo.
  expect(await itemOrder(page)).toEqual(['butter', 'bread', 'milk']);

  // Five seconds later it is greyed and out of the way.
  await expect.poll(() => itemOrder(page), { timeout: 15_000 }).toEqual(['bread', 'milk', 'butter']);
  await expect(rowFor(page, 'butter')).toHaveAttribute('data-checked', 'true');

  // Unchecking always works, and floats it back to the top of the open items.
  await rowFor(page, 'butter').getByTestId('item-check').click();
  await expect
    .poll(() => itemOrder(page), { timeout: 15_000 })
    .toEqual(['butter', 'bread', 'milk']);
  await expect(rowFor(page, 'butter')).toHaveAttribute('data-checked', 'false');
});

test('the amount buttons count up and down inside the item text', async ({ page }) => {
  await createList(page, unique('Groceries'));
  await addItem(page, 'flour');
  await addItem(page, 'butter');

  // An item with no number counts as one, so the first tap makes it two.
  await rowFor(page, 'butter').getByTestId('item-plus').click();
  await expect(rowFor(page, '2 butter')).toBeVisible();
  await rowFor(page, '2 butter').getByTestId('item-plus').click();
  await expect(rowFor(page, '3 butter')).toBeVisible();
  await rowFor(page, '3 butter').getByTestId('item-minus').click();
  await expect(rowFor(page, '2 butter')).toBeVisible();
  await rowFor(page, '2 butter').getByTestId('item-minus').click();
  await expect(rowFor(page, '1 butter')).toBeVisible();
  await rowFor(page, '1 butter').getByTestId('item-minus').click();
  await expect(rowFor(page, 'butter')).toBeVisible();

  // An amount with a unit stays readable, and still counts.
  await rowFor(page, 'flour').getByTestId('item-text').click();
  await page.getByTestId('item-input').fill('2 kg flour');
  await page.getByTestId('item-input').press('Enter');
  await expect(rowFor(page, '2 kg flour')).toBeVisible();
  await rowFor(page, '2 kg flour').getByTestId('item-plus').click();
  await expect(rowFor(page, '3 kg flour')).toBeVisible();

  // Editing never moves an item.
  expect(await itemOrder(page)).toEqual(['butter', '3 kg flour']);
});

test('items can be renamed and deleted, and clearing checked ones leaves the rest', async ({
  page,
}) => {
  await createList(page, unique('Groceries'));
  await addItem(page, 'milk');
  await addItem(page, 'bread');
  await addItem(page, 'butter');

  await rowFor(page, 'milk').getByTestId('item-text').click();
  await page.getByTestId('item-input').fill('oat milk');
  await page.getByTestId('item-input').press('Enter');
  await expect(rowFor(page, 'oat milk')).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await rowFor(page, 'bread').getByTestId('item-delete').click();
  await expect(page.getByTestId('item-row')).toHaveCount(2);

  await rowFor(page, 'butter').getByTestId('item-check').click();
  await expect(page.getByTestId('clear-checked')).toContainText('Clear checked (1)');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('clear-checked').click();

  await expect(page.getByTestId('item-row')).toHaveCount(1);
  await expect(rowFor(page, 'oat milk')).toBeVisible();
});

test('only the list’s creator gets rename, archive and delete', async ({ browser }) => {
  const name = unique('Holiday packing');

  const mum = await browser.newContext();
  const mumPage = await mum.newPage();
  await signIn(mumPage, 'mum@example.com');
  await createList(mumPage, name, '🧳');
  await addItem(mumPage, 'passports');

  const dad = await browser.newContext();
  const dadPage = await dad.newPage();
  await signIn(dadPage, 'dad@example.com');
  await dadPage.getByRole('button', { name: new RegExp(name) }).click();
  await expect(dadPage.getByTestId('item-row')).toHaveCount(1);

  // Dad may use the list, but not administer it.
  await expect(dadPage.getByTestId('rename-list')).toHaveCount(0);
  await expect(dadPage.getByTestId('archive-list')).toHaveCount(0);
  await expect(dadPage.getByTestId('delete-list')).toHaveCount(0);
  await addItem(dadPage, 'sunscreen');
  await dadPage.getByTestId('item-check').first().click();

  // Mum has the controls, and her rename reaches Dad.
  await mumPage.getByTestId('rename-list').click();
  await mumPage.getByTestId('rename-input').fill(`${name} done`);
  await mumPage.getByTestId('rename-save').click();
  await expect(mumPage.getByRole('heading', { name: new RegExp(`${name} done`) })).toBeVisible();

  await dadPage.reload();
  await expect(dadPage.getByRole('heading', { name: new RegExp(`${name} done`) })).toBeVisible();

  await mum.close();
  await dad.close();
});

test('an archived list is read-only until its creator takes it back', async ({ page }) => {
  await createList(page, unique('Holiday packing'), '🧳');
  await addItem(page, 'passports');

  await page.getByTestId('archive-list').click();
  await expect(page.getByTestId('archived-banner')).toBeVisible();
  await expect(page.getByTestId('add-item-input')).toHaveCount(0);

  await page.getByTestId('unarchive').click();
  await expect(page.getByTestId('archived-banner')).toHaveCount(0);
  await expect(page.getByTestId('add-item-input')).toBeVisible();
});

test('a list can be pinned, and pinned lists come first', async ({ page }) => {
  const first = unique('Groceries');
  const second = unique('Holiday packing');

  await createList(page, first);
  await page.getByTestId('back-to-lists').click();
  await createList(page, second, '🧳');
  await page.getByTestId('back-to-lists').click();

  await expect(page.getByTestId('list-row').first()).toContainText(second);

  await page.getByTestId('list-row').filter({ hasText: first }).getByTestId('pin-toggle').click();
  await expect(page.getByTestId('list-row').first()).toContainText(first);
});

test('a member invites the next one, and the invite link signs them up', async ({ browser }) => {
  const inviter = await browser.newContext();
  const inviterPage = await inviter.newPage();
  await signIn(inviterPage, 'mum@example.com');
  await inviterPage.getByTestId('invite-button').click();
  const link = await inviterPage.getByTestId('invite-link').inputValue();
  expect(link).toContain('/invite/');

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(new URL(link).pathname);
  await guestPage.getByTestId('name').fill('Guest');
  await guestPage.getByTestId('email').fill(`guest-${Date.now()}@example.com`);
  await guestPage.getByTestId('password').fill('correct horse');
  await guestPage.getByTestId('sign-up').click();
  await expect(guestPage.getByTestId('page-title')).toHaveText('Lists');

  await inviter.close();
  await guest.close();
});

test('the list is still there after a reload', async ({ page }) => {
  const name = unique('Groceries');
  await createList(page, name);
  await addItem(page, 'milk');

  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  await expect(rowFor(page, 'milk')).toBeVisible();
});
