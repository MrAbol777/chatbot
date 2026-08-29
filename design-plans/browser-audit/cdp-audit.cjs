const fs = require('node:fs');
const path = require('node:path');

const endpoint = 'http://127.0.0.1:9223';
const outputDir = __dirname;
const authFlow = process.argv.includes('--auth');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No page target');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    events.push(message);
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params.request;
      const url = new URL(request.url);
      let body = {};
      if (url.pathname === '/api/auth/session') {
        body = authFlow ? { authenticated: false } : {
          authenticated: true,
          provider: 'viana',
          authMethods: ['session'],
          userId: 'audit-user',
          profile: { id: 'audit-user', name: 'کاربر آزمون', age: 12, phone: '09120000000' },
          csrfToken: 'audit-csrf'
        };
      } else if (url.pathname === '/api/auth/viana/config') {
        body = { enabled: false, providerLabel: 'Viana' };
      } else if (url.pathname === '/api/auth/phone-status') {
        body = { success: true, exists: false, recommendedMode: 'signup', redirectTo: null };
      } else if (url.pathname === '/api/send-verification-code') {
        body = { success: true, deliveryStatus: 'sent' };
      } else if (url.pathname === '/api/verify-code') {
        body = { success: true, isNewUser: true, requiresProfile: true, signupToken: 'audit-signup-token' };
      } else if (url.pathname === '/api/settings/public') {
        body = { settings: {} };
      } else if (url.pathname === '/api/conversations/load') {
        body = { success: true, userId: 'audit-user', items: [] };
      } else if (url.pathname === '/api/noa/wallet' || url.pathname === '/api/noa/balance') {
        body = { wallet: { availableBalance: '125', reservedBalance: '0', totalBalance: '125' } };
      } else if (url.pathname === '/api/noa/config') {
        body = { tomanPerNoa: '1000', pricingConfigs: [] };
      } else if (url.pathname === '/api/noa/receipts') {
        body = { items: [], nextCursor: null };
      } else if (url.pathname === '/api/noa/notifications/pending') {
        body = { items: [] };
      } else if (url.pathname === '/api/video-generation/options') {
        body = { enabled: true, maxPromptLength: 1500, minDurationSeconds: 5, maxDurationSeconds: 10, defaultDurationSeconds: 5, allowedAspectRatios: ['16:9', '9:16', '1:1'], allowedStyles: ['cinematic', 'animation'], inputMedia: { enabled: true, maxSizeBytes: 10485760, allowedMimeTypes: ['image/jpeg', 'image/png'] } };
      } else if (url.pathname === '/api/video-generations') {
        body = { items: [], nextCursor: null };
      }
      const responseBody = Buffer.from(JSON.stringify(body)).toString('base64');
      void send('Fetch.fulfillRequest', {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }],
        body: responseBody
      });
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return { socket, send, events };
}

function auditExpression() {
  return `(() => {
    const selector = (element) => {
      if (!(element instanceof Element)) return '';
      if (element.id) return '#' + element.id;
      const classes = [...element.classList].slice(0, 3).join('.');
      return element.tagName.toLowerCase() + (classes ? '.' + classes : '');
    };
    const viewportWidth = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { element, rect, style };
    }).filter(({ rect, style }) => style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && (rect.left < -1 || rect.right > viewportWidth + 1)).slice(0, 30).map(({ element, rect, style }) => ({
      selector: selector(element),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      overflowX: style.overflowX,
      position: style.position
    }));
    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight },
      body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
      active: selector(document.activeElement),
      headings: [...document.querySelectorAll('h1,h2')].filter((element) => element.getBoundingClientRect().height > 0).slice(0, 12).map((element) => element.textContent.trim()),
      buttons: [...document.querySelectorAll('button')].filter((element) => element.getBoundingClientRect().height > 0).slice(0, 20).map((element) => ({ text: element.textContent.trim(), label: element.getAttribute('aria-label'), disabled: element.disabled })),
      offenders
    };
  })()`;
}

async function main() {
  const desktop = process.argv.includes('--desktop');
  const viewport = desktop && !authFlow
    ? { width: 1440, height: 1000, mobile: false, screenWidth: 1440, screenHeight: 1000 }
    : { width: 390, height: 844, mobile: true, screenWidth: 390, screenHeight: 844 };
  const suffix = desktop ? 'desktop-cdp' : 'mobile-cdp';
  const client = await connect();
  const { socket, send, events } = client;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://127.0.0.1:5173/api/*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.screenWidth,
    screenHeight: viewport.screenHeight,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false
  });
  await send('Emulation.setTouchEmulationEnabled', desktop ? { enabled: false } : { enabled: true, maxTouchPoints: 5 });

  if (authFlow) {
    const report = [];
    const capture = async (name) => {
      const result = await send('Runtime.evaluate', { expression: auditExpression(), returnByValue: true, awaitPromise: true });
      const progress = await send('Runtime.evaluate', {
        expression: `({ progress: document.querySelector('.auth-step-row')?.textContent.trim() || null, url: location.href, cardText: document.querySelector('.auth-card')?.innerText || '' })`,
        returnByValue: true
      });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      fs.writeFileSync(path.join(outputDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
      report.push({ name, metrics: result.result.value, auth: progress.result.value });
    };
    const setInputAndSubmit = async (value) => {
      await send('Runtime.evaluate', {
        expression: `(() => { const input = document.querySelector('input[type="tel"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form').requestSubmit(); })()`
      });
    };
    const clickBack = async () => {
      await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find((button) => button.textContent.includes('بازگشت')))?.click()` });
      await delay(350);
    };

    await send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5173', storageTypes: 'all' });
    await send('Network.clearBrowserCookies');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/chat?auth=signup' });
    await delay(2500);
    await capture('auth-signup-step-1-mobile-cdp');
    await setInputAndSubmit('09120000000');
    await delay(800);
    await capture('auth-signup-step-2-mobile-cdp');
    await setInputAndSubmit('12345');
    await delay(800);
    await capture('auth-signup-step-3-mobile-cdp');
    await clickBack();
    await clickBack();
    await clickBack();
    await capture('auth-signup-after-back-mobile-cdp');
    fs.writeFileSync(path.join(outputDir, 'cdp-report-auth.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    socket.close();
    return;
  }

  const pages = [
    [`root-${suffix}`, 'http://127.0.0.1:5173/'],
    [`landing-${suffix}`, 'http://127.0.0.1:5173/landing'],
    [`chat-${suffix}`, 'http://127.0.0.1:5173/chat'],
    [`studio-${suffix}`, 'http://127.0.0.1:5173/studio'],
    [`image-${suffix}`, 'http://127.0.0.1:5173/studio/image'],
    [`video-${suffix}`, 'http://127.0.0.1:5173/studio/video']
  ];
  const report = [];
  for (const [name, url] of pages) {
    const eventStart = events.length;
    await send('Page.navigate', { url });
    await delay(3500);
    const result = await send('Runtime.evaluate', { expression: auditExpression(), returnByValue: true, awaitPromise: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    fs.writeFileSync(path.join(outputDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
    const pageEvents = events.slice(eventStart);
    const consoleMessages = pageEvents.filter((event) => event.method === 'Runtime.consoleAPICalled').map((event) => ({
      type: event.params.type,
      values: event.params.args.map((arg) => arg.value ?? arg.description).filter(Boolean)
    }));
    const failures = pageEvents.filter((event) => event.method === 'Network.loadingFailed').map((event) => ({ url: event.params.requestId, error: event.params.errorText }));
    report.push({ name, metrics: result.result.value, consoleMessages, failures });
  }
  fs.writeFileSync(path.join(outputDir, `cdp-report-${desktop ? 'desktop' : 'mobile'}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  socket.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
