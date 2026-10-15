import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const measurementId = 'G-TEST123456';
const origin = 'https://maple-analytics.test';
const routes = [
  ['potential', '잠재능력 장사'],
  ['additional-trade', '에디셔널 잠재능력 장사'],
  ['ability', '어빌리티 최적 전략'],
  ['flame', '추가옵션 효율 계산기'],
  ['additional', '에디셔널 전략'],
];
let browser;
let enabledHtml;
let disabledHtml;

async function applicationHtml(id) {
  // Build the real application in memory without racing the UI suite's dist
  // output or leaving a test measurement ID in the deployment artifact.
  const result = await build({
    absWorkingDir: root, entryPoints: ['entry.jsx'], bundle: true,
    minify: true, jsx: 'automatic', write: false, outfile: 'analytics-test.js',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.GA4_MEASUREMENT_ID': JSON.stringify(id),
    },
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const workers = ['potential', 'ability', 'flame', 'additional', 'additional-trade']
    .map(name => `<script type="application/json" id="${name}-worker-source">""</script>`).join('');
  return `<!doctype html><html lang="ko"><head><style>${css}</style></head><body>
    <div id="root"></div>${workers}<script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

before(async () => {
  [enabledHtml, disabledHtml] = await Promise.all([applicationHtml(measurementId), applicationHtml('')]);
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  });
}, { timeout: 60_000 });
after(async () => { await browser?.close(); });

async function withApplication(run, { html = enabledHtml, url = `${origin}/maple-tools/`, blocked = false } = {}) {
  const context = await browser.newContext();
  const requests = [];
  const errors = [];
  try {
    // Worker correctness is covered by ui.test.mjs; these checks exercise Shell
    // routing and analytics without expensive unrelated calculations.
    await context.addInitScript(() => {
      window.Worker = class { postMessage() {} terminate() {} };
    });
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      } else {
        requests.push(request.url());
        if (!blocked && request.url().startsWith('https://www.googletagmanager.com/gtag/js?')) {
          await route.fulfill({ contentType: 'application/javascript', body: '' });
        } else {
          await route.abort();
        }
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { referer: 'https://source.example/search?private=value' });
    await page.getByRole('navigation', { name: '계산기 페이지' }).waitFor();
    await run(page, requests);
    assert.deepEqual(errors, [], 'Analytics must not break application rendering.');
  } finally {
    await context.close();
  }
}

async function queue(page) {
  return page.evaluate(() => (window.dataLayer || []).map(args => Array.from(args)));
}

async function assertViews(page, expected) {
  await page.waitForFunction(count => (window.dataLayer || []).filter(args => args[0] === 'event').length === count, expected.length);
  const entries = await queue(page);
  const views = entries.filter(args => args[0] === 'event');
  assert.deepEqual(views.map(args => args[1]), expected.map(() => 'page_view'));
  assert.deepEqual(views.map(args => args[2]), expected.map(([id, title], index) => ({
    page_title: `${title} | 메이플 계산기`,
    page_location: `${origin}/maple-tools/#/${id}`,
    page_referrer: index ? `${origin}/maple-tools/#/${expected[index - 1][0]}` : 'https://source.example/search',
    send_to: measurementId,
  })));
  assert.deepEqual(entries.filter(args => args[0] === 'config'), [['config', measurementId, { send_page_view: false }]]);
  assert.equal(entries.filter(args => args[0] === 'js').length, 1);
  assert.deepEqual(entries.filter(args => args[0] === 'set').at(-1)[1], {
    page_title: views.at(-1)[2].page_title,
    page_location: views.at(-1)[2].page_location,
    page_referrer: views.at(-1)[2].page_referrer,
  });
  assert.doesNotMatch(JSON.stringify(entries), /private|unknown/);
}

test('GA4 records initial, menu and back/forward views once with canonical URLs and titles', async () => {
  await withApplication(async (page, requests) => {
    const expected = [routes[0]];
    await assertViews(page, expected);
    for (const route of routes) {
      await page.getByRole('navigation').locator(`a[href="#/${route[0]}"]`).last().click();
      await page.waitForFunction(title => document.title === title, `${route[1]} | 메이플 계산기`);
      if (route !== routes[0]) expected.push(route);
      await assertViews(page, expected);
    }
    await page.goBack();
    expected.push(routes[3]);
    await assertViews(page, expected);
    await page.goForward();
    expected.push(routes[4]);
    await assertViews(page, expected);
    assert.equal(await page.locator('script[src*="googletagmanager.com"]').count(), 1);
    assert.deepEqual(requests, [`https://www.googletagmanager.com/gtag/js?id=${measurementId}`]);
  }, { url: `${origin}/maple-tools/?private=value#/unknown` });
});

test('missing configuration and local development never load or queue GA4', async () => {
  const cases = [
    { html: disabledHtml },
    ...['localhost', 'dev.localhost', '127.0.0.1', '127.0.0.2', '[::1]', '0.0.0.0']
      .map(host => ({ url: `http://${host}:4173/maple-tools/` })),
  ];
  for (const options of cases) {
    await withApplication(async (page, requests) => {
      await page.getByRole('navigation').locator('a[href="#/flame"]').click();
      await page.waitForFunction(() => document.title === '추가옵션 효율 계산기 | 메이플 계산기');
      assert.deepEqual(await queue(page), []);
      assert.equal(await page.evaluate(() => typeof window.gtag), 'undefined');
      assert.equal(await page.locator('script[src*="googletagmanager.com"]').count(), 0);
      assert.deepEqual(requests, []);
    }, options);
  }
});

test('blocked Google script leaves deep links and calculator navigation functional', async () => {
  await withApplication(async (page, requests) => {
    await assertViews(page, [routes[2]]);
    await page.getByRole('navigation').locator('a[href="#/flame"]').click();
    await assertViews(page, [routes[2], routes[3]]);
    assert.equal(await page.getByRole('main').count(), 1);
    assert.deepEqual(requests, [`https://www.googletagmanager.com/gtag/js?id=${measurementId}`]);
  }, { url: `${origin}/maple-tools/#/ability`, blocked: true });
});
