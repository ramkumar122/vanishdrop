import fs from 'node:fs/promises';

import { expect, test } from '@playwright/test';

async function waitForDownloads(page, action, expectedCount) {
  const downloads = [];
  const handleDownload = (download) => {
    downloads.push(download);
  };

  page.on('download', handleDownload);

  try {
    await action();
    await expect.poll(() => downloads.length).toBe(expectedCount);
    return downloads;
  } finally {
    page.off('download', handleDownload);
  }
}

async function uploadFiles(page, files, expirySelection = { mode: 'presence' }) {
  await page.goto('/');
  await expect(page.getByText('Delete after', { exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);

  if (expirySelection.mode === 'timed') {
    await page.getByRole('button', { name: 'Set your own timer' }).click();
    await page.getByLabel('Custom delete timer value').fill(String(expirySelection.value));
    await page.getByLabel('Custom delete timer unit').selectOption(expirySelection.unit);
    await expect(page.getByText(`Files will auto-delete after ${expirySelection.value} ${expirySelection.unit === 'hours' ? `hour${expirySelection.value === 1 ? '' : 's'}` : `minute${expirySelection.value === 1 ? '' : 's'}`}.`)).toBeVisible();
  }

  await page.setInputFiles(
    'input[type="file"]',
    files.map((file) => ({
      buffer: Buffer.from(file.content),
      mimeType: file.mimeType || 'text/plain',
      name: file.name,
    }))
  );

  for (const file of files) {
    await expect(page.getByText(file.name)).toBeVisible();
  }

  await page.getByRole('button', { name: 'Upload & Share Files' }).click();

  await page.waitForURL(/\/share\//);
  await expect(page.getByText(`${files.length} file`)).toBeVisible();
  await expect(page.getByText('/d/')).toBeVisible();

  return page.locator('text=/http:\\/\\/127\\.0\\.0\\.1:4173\\/d\\//').first().innerText();
}

test('uploads one link with multiple files and supports selective download', async ({ browser }) => {
  const uploaderContext = await browser.newContext();
  const uploaderPage = await uploaderContext.newPage();
  const files = [
    { name: 'hello.txt', content: 'hello from playwright' },
    { name: 'notes.txt', content: 'notes from playwright' },
  ];

  const downloadUrl = await uploadFiles(uploaderPage, files);

  const downloaderContext = await browser.newContext({ acceptDownloads: true });
  const downloaderPage = await downloaderContext.newPage();

  await downloaderPage.goto(downloadUrl);
  await expect(downloaderPage.getByText('Files available to download')).toBeVisible();
  await expect(downloaderPage.getByText('hello.txt')).toBeVisible();
  await expect(downloaderPage.getByText('notes.txt')).toBeVisible();

  await downloaderPage.getByLabel('Select hello.txt').check();

  const [singleDownload] = await waitForDownloads(
    downloaderPage,
    () => downloaderPage.getByRole('button', { name: 'Download Selected' }).click(),
    1
  );

  expect(singleDownload.suggestedFilename()).toBe('hello.txt');
  const singleDownloadPath = await singleDownload.path();
  expect(await fs.readFile(singleDownloadPath, 'utf8')).toBe('hello from playwright');

  await downloaderPage.getByRole('button', { name: 'Select All' }).click();
  const multiDownloads = await waitForDownloads(
    downloaderPage,
    () => downloaderPage.getByRole('button', { name: 'Download Selected' }).click(),
    2
  );
  const downloadedNames = multiDownloads.map((download) => download.suggestedFilename()).sort();
  expect(downloadedNames).toEqual(['hello.txt', 'notes.txt']);

  await downloaderContext.close();
  await uploaderContext.close();
});

test('makes a multi-file presence share vanish when the uploader disconnects', async ({ browser }) => {
  const uploaderContext = await browser.newContext();
  const uploaderPage = await uploaderContext.newPage();
  const downloadUrl = await uploadFiles(uploaderPage, [
    { name: 'vanish-a.txt', content: 'bye a' },
    { name: 'vanish-b.txt', content: 'bye b' },
  ]);

  const downloaderContext = await browser.newContext();
  const downloaderPage = await downloaderContext.newPage();

  await downloaderPage.goto(downloadUrl);
  await expect(downloaderPage.getByText('vanish-a.txt')).toBeVisible();
  await expect(downloaderPage.getByText('vanish-b.txt')).toBeVisible();

  await uploaderContext.close();

  await expect(downloaderPage.getByText('This share has vanished')).toBeVisible();

  await downloaderContext.close();
});

test('lets the uploader choose a custom timed delete window', async ({ browser }) => {
  const uploaderContext = await browser.newContext();
  const uploaderPage = await uploaderContext.newPage();
  const downloadUrl = await uploadFiles(
    uploaderPage,
    [{ name: 'timed.txt', content: 'timed payload' }],
    { mode: 'timed', unit: 'minutes', value: 15 }
  );

  await expect(uploaderPage.getByText(/Auto-deletes in/)).toBeVisible();

  const downloaderContext = await browser.newContext();
  const downloaderPage = await downloaderContext.newPage();

  await downloaderPage.goto(downloadUrl);
  await expect(downloaderPage.getByText('timed.txt')).toBeVisible();
  await expect(downloaderPage.getByText(/Auto-deletes in/)).toBeVisible();

  await downloaderContext.close();
  await uploaderContext.close();
});
