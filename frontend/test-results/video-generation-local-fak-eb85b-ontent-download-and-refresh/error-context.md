# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: video-generation.spec.ts >> local fake-provider video lifecycle supports desktop, range content, download, and refresh
- Location: e2e\video-generation.spec.ts:20:1

# Error details

```
Error: page.reload: net::ERR_ABORTED; maybe frame was detached?
Call log:
  - waiting for navigation until "load"

```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  | 
  3  | const model = { internalKey: 'test-video', displayNameFa: 'مدل آزمایشی', descriptionFa: 'فقط برای مرورگر محلی', supportsTextToVideo: true, supportsImageToVideo: false, allowedAspectRatios: ['16:9'], allowedDurations: ['5'], allowedQualities: ['standard'], maxPromptLength: 80, quotaUnits: 2 };
  4  | const job = (status: string) => ({ id: 'job-e2e', mode: 'text-to-video', model_key: 'test-video', status, prompt: 'یک جنگل مه آلود با دوربین آرام', aspect_ratio: '16:9', duration: '5', quality: 'standard', created_at: '2026-07-20T10:00:00.000Z', result: status === 'succeeded' ? { contentUrl: '/api/video-generations/job-e2e/content', downloadUrl: '/api/video-generations/job-e2e/content?download=1', mimeType: 'video/mp4', sizeBytes: 24 } : null });
  5  | 
  6  | async function installNetworkGuard(page: Page) {
  7  |   const external: string[] = [];
  8  |   page.on('request', (request) => { const host = new URL(request.url()).hostname; if (!['127.0.0.1', 'localhost'].includes(host)) external.push(request.url()); });
  9  |   await page.route('**/*', async (route) => { const host = new URL(route.request().url()).hostname; if (!['127.0.0.1', 'localhost'].includes(host)) return route.abort('blockedbyclient'); return route.fallback(); });
  10 |   return external;
  11 | }
  12 | 
  13 | async function seedGuestSession(page: Page) {
  14 |   await page.addInitScript(() => {
  15 |     localStorage.setItem('chat_profile', JSON.stringify({ name: 'کاربر آزمون', age: 12, personality: { interests: [], preferredStyle: 'casual', emotionState: 'neutral', messageCount: 0, lastTopics: [] } }));
  16 |     sessionStorage.setItem('chat_guest_profile', '1');
  17 |   });
  18 | }
  19 | 
  20 | test('local fake-provider video lifecycle supports desktop, range content, download, and refresh', async ({ page }) => {
  21 |   let created = false; let detailStep = 0; const contentRequests: string[] = [];
  22 |   const external = await installNetworkGuard(page);
  23 |   await seedGuestSession(page);
  24 |   await page.route('**/api/**', async (route) => {
  25 |     const request = route.request(); const url = new URL(request.url());
  26 |     if (url.pathname === '/api/settings/public') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ settings: {} }) });
  27 |     if (url.pathname === '/api/video-generation/options') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: [model] }) });
  28 |     if (url.pathname === '/api/video-generations' && request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: created ? [job(detailStep >= 4 ? 'succeeded' : 'queued')] : [] }) });
  29 |     if (url.pathname === '/api/video-generations' && request.method() === 'POST') { created = true; return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ generationId: 'job-e2e', status: 'queued', quotaUnitsReserved: 2, createdAt: '2026-07-20T10:00:00.000Z' }) }); }
  30 |     if (url.pathname === '/api/video-generations/job-e2e') { const status = ['queued', 'processing', 'storing', 'succeeded'][Math.min(detailStep++, 3)]; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(job(status)) }); }
  31 |     if (url.pathname.endsWith('/content-auth')) return route.fulfill({ contentType: 'application/json', headers: { 'Set-Cookie': 'danao_video_content=local-fixture; HttpOnly; SameSite=Strict; Path=/api/video-generations/job-e2e/content; Max-Age=300' }, body: JSON.stringify({ contentUrl: '/api/video-generations/job-e2e/content', downloadUrl: '/api/video-generations/job-e2e/content?download=1' }) });
  32 |     if (url.pathname.endsWith('/content')) { contentRequests.push(request.headers()['range'] || ''); return route.fulfill({ status: request.headers()['range'] ? 206 : 200, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes 0-23/24', 'Content-Type': 'video/mp4', 'Content-Disposition': url.searchParams.get('download') === '1' ? 'attachment; filename="fixture.mp4"' : 'inline' }, body: Buffer.from('000000186674797069736f6d000002006973736f6d', 'hex') }); }
  33 |     throw new Error(`Unexpected local API route: ${request.method()} ${url.pathname}`);
  34 |   });
  35 |   await page.setViewportSize({ width: 1440, height: 900 });
  36 |   await page.goto('/studio/video');
  37 |   await expect(page.getByLabel(/توضیحات ویدیو/)).toBeVisible();
  38 |   await page.getByLabel(/توضیحات ویدیو/).fill('یک جنگل مه آلود با دوربین آرام');
  39 |   await page.getByRole('button', { name: 'ساخت ویدیو' }).click();
  40 |   await expect(page.getByText('در صف ساخت')).toBeVisible();
  41 |   await expect(page.getByText('در حال ساخت ویدیو').first()).toBeVisible({ timeout: 12_000 });
  42 |   await expect(page.getByText('در حال آماده‌سازی فایل نهایی').first()).toBeVisible({ timeout: 12_000 });
  43 |   await expect(page.locator('video')).toBeVisible({ timeout: 15_000 });
  44 |   await page.getByRole('button', { name: 'دانلود ویدیو' }).click();
  45 |   await expect.poll(() => contentRequests.length).toBeGreaterThan(0);
  46 |   expect(contentRequests.some((range) => range.startsWith('bytes='))).toBeTruthy();
> 47 |   await page.reload();
     |              ^ Error: page.reload: net::ERR_ABORTED; maybe frame was detached?
  48 |   await expect(page.getByText('تاریخچه ویدیوها')).toBeVisible();
  49 |   await expect(page.getByText('یک جنگل مه آلود با دوربین آرام')).toBeVisible();
  50 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  51 |   expect(external).toEqual([]);
  52 | });
  53 | 
  54 | test('mobile layout stays local-only and has no horizontal overflow', async ({ page }) => {
  55 |   const external = await installNetworkGuard(page);
  56 |   await seedGuestSession(page);
  57 |   await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/settings/public') ? { settings: {} } : route.request().url().includes('/options') ? { models: [] } : { items: [] }) }));
  58 |   await page.setViewportSize({ width: 320, height: 700 });
  59 |   await page.goto('/studio/video');
  60 |   await expect(page.getByText('فعلاً مدل فعالی')).toBeVisible();
  61 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  62 |   expect(external).toEqual([]);
  63 | });
  64 | 
```