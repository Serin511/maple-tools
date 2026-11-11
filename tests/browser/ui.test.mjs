import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { solveEngine, campaignStats } from '../../potential-engine.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(root, 'dist');
const routes = [
  { path: 'potential', heading: /잠재능력.*장사/, title: '잠재능력 장사 | 메이플 계산기' },
  { path: 'additional-trade', heading: /에디셔널.*잠재능력 장사/, title: '에디셔널 잠재능력 장사 | 메이플 계산기' },
  { path: 'flame-trade', heading: /추가옵션.*장사 계산기/, title: '추가옵션 장사 | 메이플 계산기' },
  { path: 'ability', heading: /어빌리티.*최적 전략/, title: '어빌리티 최적 전략 | 메이플 계산기' },
  { path: 'flame', heading: /추가옵션.*효율 계산기/, title: '추가옵션 효율 계산기 | 메이플 계산기' },
  { path: 'additional', heading: /에디셔널.*전략 계산기/, title: '에디셔널 전략 | 메이플 계산기' },
];
let server;
let browser;
let origin;

async function cleanup() {
  try { await browser?.close(); }
  finally {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

before(async () => {
  try {
    // Validate the real production artifact, including the embedded worker bundles.
    await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: root });
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/favicon.ico') {
          response.writeHead(204).end();
          return;
        }
        let file = resolve(dist, `.${pathname}`);
        if (file !== dist && !file.startsWith(`${dist}${sep}`)) {
          response.writeHead(400).end('Bad path');
          return;
        }
        if (pathname !== '/' && !pathname.endsWith('/')) {
          const directoryIndex = join(file, 'index.html');
          try {
            await stat(directoryIndex);
            response.writeHead(308, { Location: `${pathname}/${new URL(request.url, 'http://localhost').search}` }).end();
            return;
          } catch { /* Serve a file or return a real 404 below. */ }
        }
        if (pathname.endsWith('/')) file = join(file, 'index.html');
        const body = await readFile(file);
        const mime = extname(file) === '.png' ? 'image/png'
          : extname(file) === '.css' ? 'text/css; charset=utf-8'
            : extname(file) === '.js' || extname(file) === '.mjs' ? 'text/javascript; charset=utf-8'
              : 'text/html; charset=utf-8';
        response.writeHead(200, { 'Content-Type': mime }).end(body);
      } catch (error) {
        response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, executablePath });
  } catch (error) {
    await cleanup();
    throw error;
  }
}, { timeout: 60_000 });

after(cleanup);

async function withPage(run, { viewport = { width: 1440, height: 1000 }, init, data } = {}) {
  const context = await browser.newContext({ viewport });
  const errors = [];
  try {
    if (init) await context.addInitScript(init, data);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    await run(page);
    assert.deepEqual(errors, [], 'The application must not throw uncaught browser errors.');
  } catch (error) {
    if (errors.length) error.message += `\nBrowser errors: ${errors.join('; ')}`;
    throw error;
  } finally {
    await context.close();
  }
}

async function open(page, path) {
  await page.goto(`${origin}/${path}/`);
  const route = routes.find(candidate => candidate.path === path);
  await page.getByRole('heading', { level: 1, name: route.heading }).waitFor();
}

async function waitForText(locator, text, timeout = 60_000) {
  await locator.filter({ hasText: text }).waitFor({ timeout });
  assert.match(await locator.innerText(), text);
}

async function assertNoOverflow(page, label) {
  const size = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(size.content <= size.viewport + 1, `${label}: page is ${size.content}px wide at a ${size.viewport}px viewport.`);
}

function metaContent(html, attribute, value) {
  const marker = new RegExp(`\\b${attribute}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
  const tag = html.match(/<meta\b[^>]*>/gi)?.find(candidate => marker.test(candidate));
  return tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1];
}

const primeRoutes = [
  {
    path: 'potential', storageKey: 'mpc:auto:v1',
    toggle: '프라임 큐브 모드 (레전드리 1줄 고정)', price: '프라임 큐브 가격 (억 메소 / 회)',
    defaultPrice: '7', part: '착용 부위', hat: 'hat', glove: 'glove', hatOnly: 'CD2',
    manual: 'STR', preset: true,
  },
  ...['additional', 'additional-trade'].map(path => ({
    path, storageKey: `maple:${path}:settings:v1`,
    toggle: '프라임 에디셔널 큐브 모드 (레전드리 1줄 고정)',
    price: '프라임 에디셔널 큐브 가격 (억 메소 / 회)', defaultPrice: '14',
    part: '대상 아이템 부위', hat: '모자', glove: '장갑', hatOnly: '스킬 재사용 대기시간 -1초',
    manual: 'STR +8%', preset: path === 'additional-trade',
  })),
];

// Control/restore tests do not need to wait for unrelated initial calculations.
const idleWorkers = () => {
  window.Worker = class { postMessage() {} terminate() {} };
};

test('prime settings share keyboard controls, automatic defaults and phone layout', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    await withPage(async page => {
      for (const route of primeRoutes) {
        await open(page, route.path);
        const main = page.locator('main:visible');
        const panel = main.locator('.calculator-prime-settings');
        const toggle = panel.getByRole('switch', { name: route.toggle, exact: true });
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        assert.equal(await panel.getByLabel('고정할 1줄 옵션', { exact: true }).count(), 0);
        await toggle.focus();
        await page.keyboard.press('Space');
        assert.equal(await toggle.getAttribute('aria-checked'), 'true');
        const price = panel.getByLabel(route.price, { exact: true });
        const fixed = panel.getByLabel('고정할 1줄 옵션', { exact: true });
        assert.equal(await price.inputValue(), route.defaultPrice);
        assert.equal(await fixed.inputValue(), 'auto');
        assert.equal(await fixed.locator('option').first().innerText(), '자동 최적화');
        assert.equal(await price.evaluate(input => getComputedStyle(input).appearance), 'textfield', 'Shared numeric controls must hide the native spinner.');
        await page.keyboard.press('Tab');
        assert.equal(await price.evaluate(input => input === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await fixed.evaluate(input => input === document.activeElement), true);

        await main.getByLabel(route.part, { exact: true }).selectOption(route.hat);
        await fixed.selectOption(route.hatOnly);
        assert.equal(await fixed.inputValue(), route.hatOnly);
        await main.getByLabel(route.part, { exact: true }).selectOption(route.glove);
        assert.equal(await fixed.inputValue(), 'auto', 'A first-line option unavailable on the new part must return to automatic selection.');
        assert.equal(await fixed.locator('option').filter({ hasText: route.path === 'potential' ? '쿨감' : '스킬 재사용' }).count(), 0);
        await fixed.selectOption(route.manual);
        await toggle.press('Enter');
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        await toggle.press('Enter');
        assert.equal(await fixed.inputValue(), 'auto', 'Every new activation must use automatic optimization by default.');
        await assertNoOverflow(page, `${route.path} prime settings at ${viewport.width}px`);
      }
    }, { viewport, init: idleWorkers });
  }
});

test('prime prices and manual first-line choices survive reload and trading presets', async () => {
  for (const route of primeRoutes) {
    await withPage(async page => {
      await open(page, route.path);
      const main = page.locator('main:visible');
      const panel = main.locator('.calculator-prime-settings');
      const toggle = panel.getByRole('switch', { name: route.toggle, exact: true });
      await main.getByLabel(route.part, { exact: true }).selectOption(route.hat);
      await toggle.click();
      const price = panel.getByLabel(route.price, { exact: true });
      const fixed = panel.getByLabel('고정할 1줄 옵션', { exact: true });
      await price.fill('1.25');
      await fixed.selectOption(route.hatOnly);
      await page.waitForFunction(({ key, potential, fixedKey }) => {
        const saved = JSON.parse(localStorage.getItem(key));
        return potential
          ? saved?.primeOn === true && saved.primeCostEok === '1.25' && saved.primeFixed === fixedKey
          : saved?.prime?.on === true && saved.prime.cost === 125000000 && saved.prime.fixedKey === fixedKey;
      }, { key: route.storageKey, potential: route.path === 'potential', fixedKey: route.hatOnly });

      if (route.preset) {
        await main.getByLabel('저장할 프리셋 이름', { exact: true }).fill('수동 프라임');
        await main.getByLabel('저장할 프리셋 이름', { exact: true }).press('Enter');
        await fixed.selectOption('auto');
        await price.fill('3');
        const presets = main.getByLabel('저장된 프리셋', { exact: true });
        await presets.selectOption('');
        await presets.selectOption('수동 프라임');
        assert.equal(await fixed.inputValue(), route.hatOnly, 'Applying a saved manual choice must preserve it rather than re-trigger activation.');
        assert.equal(await price.inputValue(), '1.25');
      }
      await page.reload();
      await page.getByRole('heading', { level: 1, name: routes.find(candidate => candidate.path === route.path).heading }).waitFor();
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      assert.equal(await fixed.inputValue(), route.hatOnly, 'Reloading an enabled mode must preserve its valid manual choice.');
      assert.equal(await price.inputValue(), '1.25');

      await fixed.selectOption(route.manual);
      if (route.path === 'additional') {
        await main.getByLabel('아이템의 레벨 제한', { exact: true }).fill('250');
      } else {
        await main.getByLabel(route.path === 'potential' ? '레벨 제한' : '아이템 레벨 제한', { exact: true }).selectOption('250');
      }
      assert.equal(await fixed.inputValue(), route.path === 'potential' ? route.manual : 'auto',
        'A level change must retain a valid first-line identity and replace an unavailable one.');
      if (route.path !== 'potential') {
        const obsoleteOption = fixed.locator('option[value="STR +8%"]');
        assert.equal(await obsoleteOption.count(), 0);
      }
    }, { init: idleWorkers });
  }
});

test('additional prime worker optimizes the fixed line and reports actual prime usage', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'additional');
    await waitForText(page.locator('main:visible .calculator-status'), /계산 완료/);
    const main = page.locator('main:visible');
    const optimization = main.locator('.calculator-prime-result');
    assert.match(await optimization.innerText(), /자동 최적화 결과/);
    assert.match(await optimization.innerText(), /고정 옵션:.*STR \+8%/);
    const results = main.getByRole('region', { name: '에디셔널 재설정 전략 비교 결과' });
    assert.match(await results.innerText(), /프라임 에디셔널 큐브 사용/);
    const primeAttempts = results.locator('.additional-attempt-split > span').filter({ hasText: '프라임 에디셔널 큐브' });
    const count = await primeAttempts.locator('b').innerText();
    assert.ok(Number(count.replace(/[,회]/g, '')) > 0, 'A Prime recommendation must report actual Prime attempts separately.');
    assert.match(await primeAttempts.innerText(), /메소/);
    await results.getByText('현재 등급·스택의 점수별 행동 보기', { exact: true }).click();
    assert.equal(await results.getByRole('columnheader', { name: '첫 줄 조건', exact: true }).count(), 1,
      'The prime strategy must explain actions using first-line identity rather than a scalar score alone.');
    assert.match(await results.getByRole('table').innerText(), /STR \+8%/);
    await assertNoOverflow(page, 'additional populated prime result');
  }, {
    viewport: { width: 375, height: 812 },
    init: () => localStorage.setItem('maple:additional:settings:v1', JSON.stringify({
      slot: '모자', level: 200, grade: '레전드리',
      currentOptions: ['STR +8%', '없음', '없음'],
      prime: { on: true, cost: 1000000, fixedKey: 'auto' },
    })),
  });
});

test('additional trade prime worker keeps the better baseline for a guaranteed sale', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await configureGuaranteedTrade(page);
    const main = page.locator('main:visible');
    await main.getByRole('switch', { name: '프라임 에디셔널 큐브 모드 (레전드리 1줄 고정)', exact: true }).click();
    await main.getByRole('button', { name: /장사 기대 수익 계산/ }).click();
    await waitForText(main.locator('.calculator-status'), /계산 완료/);
    const optimization = main.locator('.calculator-prime-result');
    assert.match(await optimization.innerText(), /자동 최적화 결과/);
    assert.match(await optimization.innerText(), /프라임 사용으로 늘어나는 이득이 없어 일반 재설정을 유지합니다/);
    const results = main.getByRole('region', { name: '에디셔널 장사 계산 결과' });
    assert.equal(await results.locator('.at-result-hero strong').innerText(), '8.82억 메소');
    const primeAttempts = results.locator('.at-metric-grid > div').filter({ hasText: '프라임 기대 횟수 · 현재 매물당' });
    assert.equal(await primeAttempts.locator('b').innerText(), '0회');
  });
});

test('additional trade prime worker selects a profitable first-line policy and separates its cost', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'additional-trade');
    const main = page.locator('main:visible');
    await main.getByRole('button', { name: /장사 기대 수익 계산/ }).click();
    await waitForText(main.locator('.calculator-status'), /계산 완료/);
    assert.match(await main.locator('.calculator-prime-result').innerText(), /고정 옵션:.*STR \+8%/);
    const results = main.getByRole('region', { name: '에디셔널 장사 계산 결과' });
    const attempts = results.locator('.at-metric-grid > div').filter({ hasText: '프라임 기대 횟수 · 현재 매물당' });
    assert.ok(Number((await attempts.locator('b').innerText()).replace(/[,회]/g, '')) > 0);
    const cost = results.locator('.at-metric-grid > div').filter({ hasText: '프라임 기대 비용 · 현재 매물당' });
    assert.notEqual(await cost.locator('b').innerText(), '0 메소');
    assert.match(await results.innerText(), /프라임 진입/);
    await assertNoOverflow(page, 'additional-trade populated prime result');
  }, {
    viewport: { width: 375, height: 812 },
    init: () => localStorage.setItem('maple:additional-trade:settings:v1', JSON.stringify({
      slot: '모자', level: 200, startGrade: '레전드리', itemPrice: 0, fee: 0,
      costs: { 에픽: 30800000, 유니크: 74800000, 레전드리: 100000000 },
      prime: { on: true, cost: 1, fixedKey: 'auto' },
      prices: { shared: [{ id: 'prime-str', stat: 'STR', min: 19, cd: 0, crit: 0, price: 1e12 }],
        에픽: [], 유니크: [], 레전드리: [] },
    })),
  });
});

test('additional trade prime worker explains a non-selling optimum without showing it as a finite sale', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'additional-trade');
    const main = page.locator('main:visible');
    await main.getByRole('button', { name: /장사 기대 수익 계산/ }).click();
    await waitForText(main.locator('.calculator-status'), /계산 완료/);
    assert.match(await main.locator('.calculator-prime-result').innerText(), /판매하지 않고 프라임 재설정을 계속합니다/);
    const results = main.getByRole('region', { name: '에디셔널 장사 계산 결과' });
    assert.match(await results.locator('.at-impossible').innerText(), /매물당 기대값을 정의할 수 없습니다/);
    assert.match(await results.locator('.at-impossible').innerText(), /참고 지표/);
    assert.doesNotMatch(await results.locator('.at-result-hero').innerText(), /Infinity|NaN|무한/);
    await assertNoOverflow(page, 'additional trade non-selling prime result');
  }, {
    viewport: { width: 375, height: 812 },
    init: () => localStorage.setItem('maple:additional-trade:settings:v1', JSON.stringify({
      slot: '모자', level: 200, startGrade: '레전드리', itemPrice: 2000000000, floorPrice: 0,
      autoSell: true, prime: { on: true, cost: 1000000, fixedKey: 'auto' },
      prices: { shared: [{ id: 'loss', stat: 'STR', min: 0, cd: 0, crit: 0, price: 100000000 }] },
    })),
  });
});

test('potential prime worker accepts automatic selection and publishes the chosen policy', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'potential');
    const main = page.locator('main:visible');
    await main.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    const summary = main.locator('.calculator-prime-result');
    assert.match(await summary.innerText(), /자동 최적화 결과/);
    assert.match(await summary.innerText(), /고정 옵션:.*STR\+12%/);
    assert.match(await summary.innerText(), /프라임 미사용 대비/);
    assert.match(await main.getByRole('region', { name: '잠재능력 판매가와 계산 결과' }).innerText(), /프라임 모드/);
  }, {
    init: () => localStorage.setItem('mpc:auto:v1', JSON.stringify({
      part: 'heart', level: 200, itemPriceEok: '0', floorEok: '0',
      primeOn: true, primeCostEok: '0.0000001', primeFixed: 'auto',
      statPrices: { 'l:STR_36': '10000' },
    })),
  });
});

test('all calculator routes expose their title, current navigation and one main landmark', async () => {
  await withPage(async page => {
    await open(page, 'potential');
    let sharedTypography;
    for (const route of routes) {
      const navigation = page.getByRole('navigation', { name: '계산기 페이지' });
      // Use the menu link, as the potential route also has a brand link.
      const link = navigation.locator(`a[href="/${route.path}/"]`).last();
      await link.click();
      await page.getByRole('heading', { level: 1, name: route.heading }).waitFor();
      await page.waitForFunction(title => document.title === title, route.title);
      assert.equal(await link.getAttribute('aria-current'), 'page');
      assert.equal(await navigation.locator('[aria-current="page"]').count(), 1);
      assert.equal(await page.getByRole('main').count(), 1);
      assert.equal(await page.locator('main:visible .calculator-header').count(), 1);
      const typography = await page.getByRole('heading', { level: 1, name: route.heading }).evaluate(heading => {
        const style = getComputedStyle(heading);
        return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, color: style.color };
      });
      sharedTypography ??= typography;
      assert.deepEqual(typography, sharedTypography, `${route.path}: calculator headings must share typography.`);
      await assertNoOverflow(page, route.path);
    }
    await page.goBack();
    await page.getByRole('heading', { level: 1, name: /추가옵션.*효율 계산기/ }).waitFor();
  });
});

test('built route HTML and Open Graph previews are real static files', async () => {
  const titles = new Set();
  const descriptions = new Set();
  const previewHashes = new Set();
  for (const route of routes) {
    const response = await fetch(`${origin}/${route.path}/`);
    assert.equal(response.status, 200, `${route.path} must have a directly servable document.`);
    const html = await response.text();
    assert.match(html, new RegExp(`<title>${route.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`));
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]
      ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1];
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1];
    const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    assert.ok(canonical, `${route.path} must include a canonical link.`);
    assert.equal(new URL(canonical, origin).pathname, `/${route.path}/`);
    assert.ok(description?.trim(), `${route.path} must have a page-specific description.`);
    const previewTitle = route.title.replace(/ \| 메이플 계산기$/, '');
    assert.equal(metaContent(html, 'property', 'og:title'), previewTitle);
    assert.equal(metaContent(html, 'property', 'og:description'), description);
    assert.equal(metaContent(html, 'property', 'og:url'), canonical);
    assert.equal(metaContent(html, 'property', 'og:image:alt'), `${previewTitle} 미리보기`);
    assert.ok(image, `${route.path} must declare an Open Graph image.`);
    assert.equal(new URL(image, origin).pathname, `/og/${route.path}.png`);
    assert.equal(metaContent(html, 'name', 'twitter:card'), 'summary_large_image');
    assert.equal(metaContent(html, 'name', 'twitter:title'), previewTitle);
    assert.equal(metaContent(html, 'name', 'twitter:description'), description);
    assert.equal(metaContent(html, 'name', 'twitter:image'), image);
    assert.equal(metaContent(html, 'name', 'twitter:image:alt'), `${previewTitle} 미리보기`);
    titles.add(route.title);
    descriptions.add(description);
    const png = await fetch(`${origin}/og/${route.path}.png`);
    assert.equal(png.status, 200, `${route.path} preview must be publicly resolvable.`);
    assert.match(png.headers.get('content-type') ?? '', /image\/png/i);
    const bytes = Buffer.from(await png.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    previewHashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(titles.size, routes.length, 'Each static route must have its own document title.');
  assert.equal(descriptions.size, routes.length, 'Each static route must have its own description.');
  assert.equal(previewHashes.size, routes.length, 'Each calculator menu must have a distinct preview image.');
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /<title>[^<]+<\/title>/);
  assert.equal(metaContent(homeHtml, 'property', 'og:title'), '메이플 계산기');
  assert.equal(metaContent(homeHtml, 'property', 'og:url'), 'https://maple-tools.celia.moe/');
  assert.equal(metaContent(homeHtml, 'property', 'og:image:alt'), '메이플 계산기 미리보기');
  assert.equal(metaContent(homeHtml, 'name', 'twitter:card'), 'summary_large_image');
  assert.ok(/property=["']og:image["'][^>]+content=["'][^"']*\/og\/home\.png/i.test(homeHtml)
    || /content=["'][^"']*\/og\/home\.png["'][^>]+property=["']og:image["']/i.test(homeHtml));
  const homePng = await fetch(`${origin}/og/home.png`);
  assert.equal(homePng.status, 200);
  assert.match(homePng.headers.get('content-type') ?? '', /image\/png/i);
  const homeBytes = Buffer.from(await homePng.arrayBuffer());
  assert.deepEqual([...homeBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(homeBytes.toString('ascii', 12, 16), 'IHDR');
  assert.equal(homeBytes.readUInt32BE(16), 1200);
  assert.equal(homeBytes.readUInt32BE(20), 630);
  const missing = await fetch(`${origin}/not-a-calculator/`);
  assert.equal(missing.status, 404, 'Unknown routes must not receive the home page fallback.');
  const traversal = await fetch(`${origin}/%2e%2e%2fpackage.json`);
  assert.notEqual(traversal.status, 200, 'Static serving must stay inside dist/.');
});

test('clean routes, legacy hashes, query strings and browser history work together', async () => {
  await withPage(async page => {
    await page.goto(`${origin}/potential?from=clean`);
    assert.equal(new URL(page.url()).pathname, '/potential/');
    assert.equal(new URL(page.url()).search, '?from=clean');
    await page.getByRole('heading', { level: 1, name: routes[0].heading }).waitFor();
    await page.reload();
    await page.getByRole('heading', { level: 1, name: routes[0].heading }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/potential/');
    const price = page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true });
    await price.fill('12.5');
    await page.getByRole('navigation').locator('a[href^="/ability/"]').click();
    await page.getByRole('heading', { level: 1, name: routes[3].heading }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/ability/');
    assert.equal(new URL(page.url()).search, '?from=clean');
    await page.goBack();
    await page.getByRole('heading', { level: 1, name: routes[0].heading }).waitFor();
    assert.equal(await price.inputValue(), '12.5', 'History navigation must retain the mounted calculator inputs.');
    await page.goForward();
    await page.getByRole('heading', { level: 1, name: routes[3].heading }).waitFor();

    await page.goto(`${origin}/?campaign=spring#/flame`);
    await page.getByRole('heading', { level: 1, name: routes[4].heading }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/flame/');
    assert.equal(new URL(page.url()).search, '?campaign=spring');
    await page.evaluate(() => { location.hash = '#/additional'; });
    await page.getByRole('heading', { level: 1, name: routes[5].heading }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/additional/');
    assert.equal(new URL(page.url()).search, '?campaign=spring', 'Hash canonicalization must preserve the query string.');
    await page.goto(`${origin}/flame/index.html?campaign=direct`);
    await page.getByRole('heading', { level: 1, name: routes[4].heading }).waitFor();
    assert.equal(await page.title(), routes[4].title);
    assert.equal(await page.getByRole('navigation').locator('a[href^="/ability/"]').count(), 1);
    assert.equal(new URL(page.url()).search, '?campaign=direct');

    const nativeLink = page.getByRole('navigation').locator('a[href^="/ability/"]');
    const prevented = await nativeLink.evaluate(anchor => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
      anchor.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(prevented, false, 'Modified menu clicks must retain native browser behavior.');
  });
});

test('every legacy hash route resolves to the matching clean page', async () => {
  await withPage(async page => {
    for (const route of routes) {
      await page.goto(`${origin}/#/${route.path}`);
      await page.getByRole('heading', { level: 1, name: route.heading }).waitFor();
      assert.equal(await page.title(), route.title);
      assert.equal(new URL(page.url()).pathname, `/${route.path}/`);
      assert.equal(new URL(page.url()).hash, '');
      const current = page.getByRole('navigation').locator('[aria-current="page"]');
      assert.equal(await current.count(), 1);
      assert.equal(await current.getAttribute('href'), `/${route.path}/`);
    }
  }, { init: idleWorkers });
});

test('file-based root app continues to use legacy hash navigation', async () => {
  await withPage(async page => {
    const fileRoot = pathToFileURL(join(dist, 'index.html')).href;
    await page.goto(`${fileRoot}#/flame`);
    await page.getByRole('heading', { level: 1, name: routes[4].heading }).waitFor();
    assert.equal(await page.title(), routes[4].title);
    const link = page.getByRole('navigation').locator('a[href="#/ability"]');
    assert.equal(await link.count(), 1);
    await link.click();
    await page.getByRole('heading', { level: 1, name: routes[3].heading }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/ability');
  }, { init: idleWorkers });
});

test('all calculator routes fit a 375px phone, including populated results', { timeout: 180_000 }, async () => {
  await withPage(async page => {
    for (const route of routes) {
      await open(page, route.path);
      if (['ability', 'flame', 'additional'].includes(route.path)) {
        await waitForText(page.getByRole('status'), /계산 완료/);
      }
      await assertNoOverflow(page, route.path);
    }
    await configureGuaranteedTrade(page);
    await assertNoOverflow(page, 'additional-trade result');
    await configureFlameTrade(page);
    await assertNoOverflow(page, 'flame-trade result');
    await open(page, 'potential');
    await page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true }).fill('10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    await assertNoOverflow(page, 'potential result');
  }, { viewport: { width: 375, height: 812 } });
});

test('ability worker computes default strategy and rejects invalid market prices', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'ability');
    await waitForText(page.getByRole('status'), /계산 완료/);
    const results = page.getByRole('region', { name: '전략 계산 결과' });
    assert.match(await results.innerText(), /명성치 구매비/);
    assert.match(await results.locator('.ability-total-number').innerText(), /[\d,.]+억/);
    await page.getByLabel('1억 메소당 메이플포인트', { exact: true }).fill('0');
    await page.getByRole('button', { name: /최적 전략 계산/ }).click();
    await waitForText(page.getByRole('alert'), /메소마켓|시세|포인트/);
  });
});

test('ability wildcard slots persist, omit value controls, and accept unrelated third options', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'ability');
    const option1 = page.getByLabel('1순위 옵션 1', { exact: true });
    const option2 = page.getByLabel('1순위 옵션 2', { exact: true });
    const option3 = page.getByLabel('1순위 옵션 3', { exact: true });
    await option1.selectOption('drop');
    await option2.selectOption('meso');
    await option3.selectOption('unspecified');
    await page.getByLabel('1순위 옵션 1 목표 수치', { exact: true }).fill('8');
    await page.getByLabel('1순위 옵션 2 목표 수치', { exact: true }).fill('8');
    assert.equal(await page.getByLabel('1순위 옵션 3 최소 등급', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('1순위 옵션 3 목표 수치', { exact: true }).count(), 0);
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('maple:ability:sets:v1'));
      return saved?.sets?.[0]?.map(goal => goal.option).join(',') === 'drop,meso,unspecified';
    });

    await page.reload();
    await page.getByRole('heading', { level: 1, name: /어빌리티.*최적 전략/ }).waitFor();
    assert.equal(await page.getByLabel('1순위 옵션 1', { exact: true }).inputValue(), 'drop');
    assert.equal(await page.getByLabel('1순위 옵션 2', { exact: true }).inputValue(), 'meso');
    assert.equal(await page.getByLabel('1순위 옵션 3', { exact: true }).inputValue(), 'unspecified');

    await waitForText(page.getByRole('status'), /계산 완료/);
    const results = page.getByRole('region', { name: '전략 계산 결과' });
    const selectors = [1, 2, 3].map(line => results.getByLabel(`현재 ${line}줄 상태`, { exact: true }));
    for (const [line, target] of [[1, '아이템 드롭률'], [2, '메소 획득량']]) {
      const selector = selectors[line - 1];
      const value = await selector.locator('option').filter({ hasText: target }).first().getAttribute('value');
      assert.ok(value, `Expected a selectable ${target} state in line ${line}.`);
      await selector.selectOption(value);
    }
    const unrelated = await selectors[2].locator('option').filter({ hasText: '목표 미해당' }).first().getAttribute('value');
    assert.ok(unrelated, 'Expected an unrelated option for the wildcard third line.');
    await selectors[2].selectOption(unrelated);
    await waitForText(results.locator('.ability-next-action'), /목표 달성 · 종료/);
  });
});

test('flame worker returns a stopping rule, then shows an input error', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'flame');
    await waitForText(page.getByRole('status'), /계산 완료/);
    const results = page.getByRole('region', { name: '추가옵션 종료 기준 계산 결과' });
    assert.match(await results.innerText(), /여기서부터 예상되는 결과/);
    assert.match(await results.innerText(), /주스텟|주스탯/);
    await page.getByLabel('아이템의 레벨 제한', { exact: true }).fill('0');
    await page.getByRole('button', { name: /멈출 추가옵션 계산/ }).click();
    await waitForText(page.getByRole('alert'), /레벨/);
  });
});

test('invalid ability recalculation cancels the old worker and ignores its late responses', async () => {
  await withPage(async page => {
    await open(page, 'ability');
    await page.getByRole('button', { name: /현재 설정으로 다시 계산/ }).waitFor();
    await page.getByLabel('1순위 옵션 1 목표 수치', { exact: true }).fill('-1');
    await page.getByRole('button', { name: /현재 설정으로 다시 계산|최적 전략 계산/ }).click();
    await waitForText(page.getByRole('alert'), /목표 수치/);
    await page.getByRole('button', { name: /최적 전략 계산/ }).waitFor();
    assert.equal(await page.evaluate(() => window.calculationWorkers[0].terminated), true);
    await page.evaluate(() => {
      const worker = window.calculationWorkers[0];
      const id = worker.messages.find(message => message.type === 'calculate').id;
      worker.onmessage?.({ data: { id, type: 'progress', message: '지연된 계산 진행' } });
      worker.onmessage?.({ data: { id, type: 'complete' } });
      worker.onmessage?.({ data: { id, type: 'error', message: '지연된 계산 오류' } });
      worker.onerror?.(new Event('error'));
    });
    assert.match(await page.getByRole('alert').innerText(), /목표 수치/);
    assert.doesNotMatch(await page.getByRole('status').innerText(), /지연된|계산 완료/);
    await page.getByRole('button', { name: /최적 전략 계산/ }).waitFor();
  }, {
    init: () => {
      window.calculationWorkers = [];
      window.Worker = class {
        constructor() { this.messages = []; this.terminated = false; window.calculationWorkers.push(this); }
        postMessage(message) { this.messages.push(message); }
        terminate() { this.terminated = true; }
      };
    },
  });
});

test('additional worker computes real strategy comparisons', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'additional');
    await waitForText(page.getByRole('status'), /계산 완료/);
    const results = page.getByRole('region', { name: '에디셔널 재설정 전략 비교 결과' });
    assert.match(await results.innerText(), /전략별 비교/);
    assert.match(await results.innerText(), /여기서부터 예상되는 결과/);
    assert.ok(await results.getByRole('button', { pressed: true }).count() > 0, 'A calculated strategy must be selected.');
  });
});

test('additional calculators share seven efficiency inputs and use the fixed character mapping', async () => {
  await withPage(async page => {
    for (const path of ['additional', 'additional-trade']) {
      await open(page, path);
      const efficiencies = page.locator('main:visible .calculator-character-efficiency');
      assert.equal(await efficiencies.getByLabel('기준 캐릭터 레벨', { exact: true }).inputValue(), '290');
      assert.equal(await efficiencies.getByRole('spinbutton').count(), 8); // Character level plus seven shared efficiencies.
      assert.equal(await efficiencies.getByLabel('크리티컬 데미지 +1%의 주스탯 환산 효율 (%)', { exact: true }).inputValue(), '4');
      assert.match(await efficiencies.innerText(), /STR → DEX.*DEX → STR.*INT → LUK.*LUK → DEX/);
      assert.equal(await page.getByRole('combobox', { name: '캐릭터 부스탯', exact: true }).count(), 0);
      assert.equal(await page.getByRole('combobox', { name: '공격력 또는 마력', exact: true }).count(), 0);
      assert.equal(await efficiencies.getByRole('spinbutton', { name: /드롭률|메소 획득/ }).count(), 0);
      if (path === 'additional') {
        await page.getByLabel('캐릭터 주스탯', { exact: true }).selectOption('INT');
        await page.waitForFunction(() => {
          const saved = JSON.parse(localStorage.getItem('maple:additional:settings:v1'));
          return saved?.mainStat === 'INT' && saved.subStat === 'LUK' && saved.attackType === 'magic';
        });
      }
    }
  });
});

const tradeEquipment = [
  {
    path: 'potential', storageKey: 'mpc:auto:v1',
    purchase: '노작 매입가 (억 메소)', level: '레벨 제한', part: '착용 부위',
    stacks: ['현재 유→레 천장 스택 (0~107)'],
    floor: '레전 깡통·잡옵 처분가 (억, 폴백용)',
  },
  {
    path: 'additional-trade', storageKey: 'maple:additional-trade:settings:v1',
    purchase: '시작 등급 깡통 매입가 (억 메소)', level: '아이템 레벨 제한', part: '대상 아이템 부위',
    grade: '재설정 시작 등급', stacks: ['에픽 현재 등급업 실패 스택', '유니크 현재 등급업 실패 스택'],
    floor: '레전드리 잡옵 처분가 (억 메소)',
  },
  {
    path: 'flame-trade', storageKey: 'maple:flame-trade:settings:v1',
    purchase: '노작 매입가 (억 메소)', level: '아이템 레벨 제한', stacks: [],
    floor: '잡추옵 처분가 (억 메소)',
  },
];

test('trading equipment panels share the potential workflow and full-width controls on desktop and phone', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    await withPage(async page => {
      for (const fields of tradeEquipment) {
        await open(page, fields.path);
        const panel = page.locator('main:visible .calculator-trade-equipment');
        assert.equal(await panel.count(), 1);
        assert.equal(await panel.getByRole('heading', { level: 2, name: '장비 설정', exact: true }).count(), 1);
        const expectedOrder = [fields.purchase, fields.level, ...(fields.part ? [fields.part] : []), ...(fields.grade ? [fields.grade] : []),
          ...fields.stacks, '경매장 수수료 (%)', fields.floor];
        const controls = panel.locator('input[type="number"], select');
        assert.deepEqual(await controls.evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label'))), expectedOrder);
        const geometry = await controls.evaluateAll(inputs => inputs.map(input => {
          // A number field's visible border also contains its unit suffix.
          const control = input.closest('.calculator-input-unit') || input;
          const rectangle = control.getBoundingClientRect();
          const card = input.closest('.calculator-card');
          const style = getComputedStyle(card);
          return {
            x: rectangle.x, y: rectangle.y, bottom: rectangle.bottom, width: rectangle.width,
            available: card.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
              - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
          };
        }));
        for (let index = 0; index < geometry.length; index += 1) {
          const control = geometry[index];
          assert.ok(Math.abs(control.width - control.available) <= 1, `${fields.path}: ${expectedOrder[index]} must fill its settings card.`);
          if (index) {
            assert.ok(control.y >= geometry[index - 1].bottom, `${fields.path}: controls must follow the same vertical order.`);
            assert.ok(Math.abs(control.x - geometry[0].x) <= 1, `${fields.path}: controls must share the same left edge.`);
          }
        }
        await controls.first().focus();
        for (let index = 1; index < expectedOrder.length; index += 1) {
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), expectedOrder[index]);
        }
        await assertNoOverflow(page, `${fields.path} equipment settings at ${viewport.width}px`);
      }
    }, { viewport });
  }
});

test('shared trading equipment inputs keep each calculator\'s units, blanks and saved settings', async () => {
  // The flame trade has no part or pity inputs; its own test covers its settings.
  for (const fields of tradeEquipment.filter(candidate => candidate.part)) {
    await withPage(async page => {
      await open(page, fields.path);
      const panel = page.locator('main:visible .calculator-trade-equipment');
      await panel.getByLabel(fields.purchase, { exact: true }).fill('2.375');
      await panel.getByLabel(fields.level, { exact: true }).selectOption('250');
      await panel.getByLabel(fields.part, { exact: true }).selectOption(fields.grade ? '장갑' : 'hat');
      if (fields.grade) await panel.getByLabel(fields.grade, { exact: true }).selectOption('유니크');
      await panel.getByLabel(fields.stacks.at(-1), { exact: true }).fill('23');
      await panel.getByLabel('경매장 수수료 (%)', { exact: true }).fill('2.75');
      await panel.getByLabel(fields.floor, { exact: true }).fill('1.125');
      const expected = fields.grade
        ? { itemPrice: 237500000, floorPrice: 112500000, fee: 2.75, level: 250, slot: '장갑', startGrade: '유니크' }
        : { itemPriceEok: '2.375', floorEok: '1.125', fee: '2.75', level: 250, part: 'hat', pity: '23' };
      await page.waitForFunction(({ key, values }) => {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved && Object.entries(values).every(([name, value]) => saved[name] === value);
      }, { key: fields.storageKey, values: expected });
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), fields.storageKey);
      if (fields.grade) {
        assert.equal(saved.stacks.유니크, 23);
        assert.deepEqual(saved.costs, { 에픽: 34300000, 유니크: 83300000, 레전드리: 98000000 }, 'Selecting a new item level must update reset costs.');
      }
      await page.reload();
      await panel.waitFor();
      assert.equal(await panel.getByLabel(fields.purchase, { exact: true }).inputValue(), '2.375');
      assert.equal(await panel.getByLabel(fields.floor, { exact: true }).inputValue(), '1.125');
      assert.equal(await panel.getByLabel('경매장 수수료 (%)', { exact: true }).inputValue(), '2.75');
      assert.equal(await panel.getByLabel(fields.level, { exact: true }).inputValue(), '250');
      assert.equal(await panel.getByLabel(fields.part, { exact: true }).inputValue(), fields.grade ? '장갑' : 'hat');
      assert.equal(await panel.getByLabel(fields.stacks.at(-1), { exact: true }).inputValue(), '23');
      for (const label of [fields.purchase, fields.floor, '경매장 수수료 (%)']) {
        await panel.getByLabel(label, { exact: true }).fill('');
      }
      const blankKeys = fields.grade ? ['itemPrice', 'floorPrice', 'fee'] : ['itemPriceEok', 'floorEok', 'fee'];
      await page.waitForFunction(({ key, names }) => {
        const settings = JSON.parse(localStorage.getItem(key));
        return settings && names.every(name => settings[name] === '');
      }, { key: fields.storageKey, names: blankKeys });
      await page.reload();
      await panel.waitFor();
      for (const label of [fields.purchase, fields.floor, '경매장 수수료 (%)']) {
        assert.equal(await panel.getByLabel(label, { exact: true }).inputValue(), '', 'Clearing a price or fee must remain an empty input after reload.');
      }
    });
  }
});

test('additional equipment settings expose reachable pity stacks and retain each part\'s sale prices', async () => {
  await withPage(async page => {
    await open(page, 'additional-trade');
    const panel = page.locator('main:visible .calculator-trade-equipment');
    const epicStack = page.getByLabel('에픽 현재 등급업 실패 스택', { exact: true });
    const uniqueStack = page.getByLabel('유니크 현재 등급업 실패 스택', { exact: true });
    assert.equal(await epicStack.count(), 1, 'Current epic stacks must be editable in one place.');
    assert.equal(await uniqueStack.count(), 1, 'Current unique stacks must be editable in one place.');
    await epicStack.fill('17');
    await uniqueStack.fill('29');
    const startGrade = panel.getByLabel('재설정 시작 등급', { exact: true });
    await startGrade.selectOption('유니크');
    assert.equal(await epicStack.count(), 0, 'Epic stacks do not affect a trade that starts at unique.');
    assert.equal(await uniqueStack.inputValue(), '29');
    await startGrade.selectOption('레전드리');
    assert.equal(await epicStack.count(), 0);
    assert.equal(await uniqueStack.count(), 0, 'Legendary trades have no further grade-up stack.');
    await startGrade.selectOption('에픽');
    assert.equal(await epicStack.inputValue(), '17');
    assert.equal(await uniqueStack.inputValue(), '29');

    await page.getByRole('button', { name: /가격 조건 추가/ }).click();
    const price = page.getByLabel('공통 1번 가격 조건의 시세 (억 메소)', { exact: true });
    await price.fill('10');
    const part = panel.getByLabel('대상 아이템 부위', { exact: true });
    await part.selectOption('장갑');
    assert.equal(await price.count(), 0, 'Changing parts must show the selected part\'s price bank.');
    await page.getByRole('button', { name: /가격 조건 추가/ }).click();
    await price.fill('12');
    await part.selectOption('모자');
    assert.equal(await price.inputValue(), '10');
    await part.selectOption('장갑');
    assert.equal(await price.inputValue(), '12');
    await page.reload();
    await panel.waitFor();
    assert.equal(await part.inputValue(), '장갑');
    assert.equal(await price.inputValue(), '12');
    await part.selectOption('모자');
    assert.equal(await price.inputValue(), '10', 'Returning after reload must recover the previous part\'s price bank.');
  });
});

test('additional calculators fix grade-up rules while retaining saved equipment, current stacks and trade presets', async () => {
  const discountedCosts = { 에픽: 17000000, 유니크: 45000000, 레전드리: 66000000 };
  const oldSettings = {
    slot: '장갑', level: 160, grade: '에픽', startGrade: '에픽', costs: discountedCosts,
    upRates: { 에픽: 0.5, 유니크: 0.6 }, pity: { 에픽: 20, 유니크: 40 }, stacks: { 에픽: 13, 유니크: 27 },
  };
  for (const route of [
    { path: 'additional', key: 'maple:additional:settings:v1', grade: '현재 에디셔널 잠재능력 등급' },
    { path: 'additional-trade', key: 'maple:additional-trade:settings:v1', grade: '재설정 시작 등급' },
  ]) {
    await withPage(async page => {
      await open(page, route.path);
      const panel = page.locator('main:visible .calculator-trade-equipment');
      assert.equal(await panel.getByRole('heading', { level: 2, name: '장비 설정', exact: true }).count(), 1);
      assert.equal(await page.getByRole('heading', { level: 2, name: '재설정 비용', exact: true }).count(), 1);
      assert.equal(await page.getByRole('spinbutton', { name: /등급업 확률|확정 등급업|천장 실패 횟수/, includeHidden: true }).count(), 0,
        'Grade-up probabilities and guaranteed grade-up limits must not remain editable, including in collapsed panels.');
      await page.waitForFunction(key => {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved?.upRates?.에픽 === 0.009804 && saved.upRates.유니크 === 0.007
          && saved.pity?.에픽 === 152 && saved.pity.유니크 === 214;
      }, route.key);
      const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), route.key);
      assert.equal(restored.level, 160);
      assert.equal(restored.slot, '장갑');
      assert.deepEqual(restored.costs, discountedCosts, 'Restoring official grade-up rules must preserve discounted reset costs.');
      const epicStack = panel.getByLabel('에픽 현재 등급업 실패 스택', { exact: true });
      const uniqueStack = panel.getByLabel('유니크 현재 등급업 실패 스택', { exact: true });
      assert.equal(await epicStack.inputValue(), '13');
      assert.equal(await uniqueStack.inputValue(), '27');
      assert.equal(await epicStack.getAttribute('max'), '152');
      assert.equal(await uniqueStack.getAttribute('max'), '214');
      await epicStack.fill('15');
      await uniqueStack.fill('31');
      const grade = panel.getByLabel(route.grade, { exact: true });
      await grade.selectOption('유니크');
      assert.equal(await epicStack.count(), 0);
      assert.equal(await uniqueStack.inputValue(), '31');
      await grade.selectOption('레전드리');
      assert.equal(await uniqueStack.count(), 0);
      await grade.selectOption('에픽');
      assert.equal(await epicStack.inputValue(), '15');
      assert.equal(await uniqueStack.inputValue(), '31');
      await page.waitForFunction(key => {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved?.stacks?.에픽 === 15 && saved.stacks.유니크 === 31;
      }, route.key);
      await page.reload();
      await panel.waitFor();
      assert.equal(await epicStack.inputValue(), '15');
      assert.equal(await uniqueStack.inputValue(), '31');

      if (route.path === 'additional-trade') {
        await page.getByLabel('저장된 프리셋', { exact: true }).selectOption('이전 규칙');
        await page.waitForFunction(key => {
          const saved = JSON.parse(localStorage.getItem(key));
          return saved?.startGrade === '유니크' && saved.stacks?.유니크 === 76;
        }, route.key);
        const preset = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), route.key);
        assert.deepEqual(preset.upRates, { 에픽: 0.009804, 유니크: 0.007 });
        assert.deepEqual(preset.pity, { 에픽: 152, 유니크: 214 });
        assert.deepEqual(preset.stacks, { 에픽: 55, 유니크: 76 }, 'Current stacks must survive migration even when they exceed the obsolete saved limit.');
        assert.equal(preset.itemPrice, 320000000);
        assert.equal(await panel.getByLabel('시작 등급 깡통 매입가 (억 메소)', { exact: true }).inputValue(), '3.2');
        assert.equal(await uniqueStack.inputValue(), '76');
      }
    }, {
      data: { key: route.key, settings: oldSettings },
      init: ({ key, settings }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
        const presetsKey = 'maple:additional-trade:presets:v1';
        if (key.includes('additional-trade') && !localStorage.getItem(presetsKey)) {
          localStorage.setItem(presetsKey, JSON.stringify({ '이전 규칙': {
            ...settings, startGrade: '유니크', itemPrice: 320000000,
            stacks: { 에픽: 55, 유니크: 76 },
          } }));
        }
      },
    });
  }
});

test('trading sale editors share the wide results area and preserve prices through keyboard grade selection', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    await withPage(async page => {
      let commonGradeLabels;
      for (const path of ['potential', 'additional-trade']) {
        await open(page, path);
        const results = page.locator('main:visible .calculator-results');
        const editor = results.locator(':scope > .trade-price-editor');
        assert.equal(await editor.count(), 1, 'Sale prices belong in the main area beside equipment settings.');
        assert.equal(await editor.getByRole('heading', { level: 2, name: '판매가', exact: true }).count(), 1);
        if (path === 'additional-trade') {
          await editor.getByRole('button', { name: '등급별 가격 입력으로 전환', exact: true }).click();
        }
        const gradeButtons = editor.locator('.trade-price-grade-buttons');
        const legendary = gradeButtons.getByRole('button', { name: /^레전드리(?: 매물 가격)?$/ });
        const unique = gradeButtons.getByRole('button', { name: /^유니크(?: 매물 가격)?$/ });
        const gradeLabels = [await unique.innerText(), await legendary.innerText()];
        commonGradeLabels ??= gradeLabels;
        assert.deepEqual(gradeLabels, commonGradeLabels, 'The same sale grades must have the same button labels in both trading calculators.');
        const price = editor.getByLabel(path === 'potential'
          ? '유니크 STR 12% 판매가 (억 메소)' : '레전드리 1번 가격 조건의 시세 (억 메소)', { exact: true });
        if (path === 'potential') {
          await price.fill('10');
          await legendary.press('Enter');
          assert.equal(await legendary.getAttribute('aria-pressed'), 'true');
          await unique.press('Enter');
        } else {
          await legendary.press('Enter');
          assert.equal(await legendary.getAttribute('aria-pressed'), 'true');
          await editor.getByRole('button', { name: /가격 조건 추가/ }).click();
          await price.fill('10');
          await unique.press('Enter');
          await legendary.press('Enter');
        }
        assert.equal(await price.inputValue(), '10', 'Changing the visible grade must preserve its entered sale price.');
        const geometry = await editor.evaluate(element => {
          const rect = node => {
            const { x, y, width, bottom, right } = node.getBoundingClientRect();
            return { x, y, width, bottom, right };
          };
          const main = element.closest('main');
          return {
            editor: rect(element), results: rect(element.parentElement),
            equipment: rect(main.querySelector('.calculator-trade-equipment')),
            layout: rect(main.querySelector('.calculator-layout')),
          };
        });
        assert.ok(Math.abs(geometry.editor.width - geometry.results.width) <= 1, `${path}: sale editor must fill the results column.`);
        if (viewport.width > 800) {
          assert.ok(geometry.editor.x >= geometry.equipment.right, `${path}: sale editor must sit beside equipment settings.`);
          assert.ok(geometry.editor.width > geometry.equipment.width, `${path}: prices need the wider main column.`);
        } else {
          assert.ok(geometry.editor.y >= geometry.equipment.bottom, `${path}: sale editor must follow equipment settings on a phone.`);
          assert.ok(Math.abs(geometry.editor.width - geometry.layout.width) <= 1, `${path}: phone price entry must use the full content width.`);
        }
        await assertNoOverflow(page, `${path} populated sale editor at ${viewport.width}px`);
      }
    }, { viewport });
  }
});

async function configureGuaranteedTrade(page) {
  await open(page, 'additional-trade');
  await page.getByLabel('재설정 시작 등급', { exact: true }).selectOption('레전드리');
  await page.getByRole('button', { name: /가격 조건 추가/ }).click();
  await page.getByLabel('공통 1번 가격 조건의 최소 스탯 환산 (%)', { exact: true }).fill('0');
  await page.getByLabel('공통 1번 가격 조건의 시세 (억 메소)', { exact: true }).fill('10');
  await page.getByRole('button', { name: /장사 기대 수익 계산/ }).click();
  await waitForText(page.getByRole('status'), /계산 완료/);
}

async function configureFlameTrade(page) {
  await open(page, 'flame-trade');
  const main = page.locator('main:visible');
  const add = main.getByRole('button', { name: '＋ 판매가 조건 추가', exact: true });
  await main.getByLabel('노작 매입가 (억 메소)', { exact: true }).fill('2.5');
  await add.click();
  await main.getByLabel('1번 판매가 조건의 추가옵션 환산 급수', { exact: true }).fill('140');
  await main.getByLabel('1번 판매가 조건의 판매가 (억 메소)', { exact: true }).fill('2');
  await add.click();
  await main.getByLabel('2번 판매가 조건의 입력 방식', { exact: true }).selectOption('stats');
  await main.getByLabel('2번 판매가 조건의 주스탯', { exact: true }).fill('120');
  await main.getByLabel('2번 판매가 조건의 올스탯%', { exact: true }).fill('4');
  await main.getByLabel('2번 판매가 조건의 판매가 (억 메소)', { exact: true }).fill('12');
  await waitForText(page.getByRole('status'), /계산 완료/);
}

test('flame trade prices total and stat rows, holds sales below the purchase price and restores presets', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'flame-trade');
    const main = page.locator('main:visible');
    assert.match(await main.getByRole('status').innerText(), /판매가를 입력하면/);
    assert.equal(await main.getByRole('button', { name: /장사 기대 수익 계산/ }).isDisabled(), true);
    await configureFlameTrade(page);
    // Default conversion: 120 + 4% all-stat * 11 = 164 grades.
    assert.match(await main.locator('.ft-row-grade').innerText(), /164급/);
    const results = page.getByRole('region', { name: '추가옵션 장사 판매가와 계산 결과' });
    assert.equal(await results.locator('.flame-threshold strong').innerText(), '164급');
    const decisions = await results.locator('.ft-decisions tbody tr').evaluateAll(rows => rows.map(row => [row.cells[0].innerText, row.cells[2].innerText]));
    assert.deepEqual(decisions.map(([, decision]) => decision), ['판매', '계속 재설정', '계속 재설정'],
      'A 2억 result nets less than the 2.5억 purchase price, so it is better to keep resetting.');
    assert.match(decisions[1][0], /140급 이상/);
    assert.equal(await results.locator('.ft-summary-metric b').first().getAttribute('class'), 'ft-positive');
    assert.match(await results.innerText(), /가격 조건에 도달하는 즉시 판매할 때/);
    await page.waitForFunction(key => {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved?.itemPrice === 250000000 && saved.prices.length === 2 && saved.prices[1].mode === 'stats' && saved.prices[1].price === 1200000000;
    }, 'maple:flame-trade:settings:v1');

    // An input error replaces the stale result until the input is valid again.
    const fee = main.getByLabel('경매장 수수료 (%)', { exact: true });
    await fee.fill('');
    await waitForText(main.getByRole('alert'), /수수료/);
    assert.equal(await results.locator('.ft-summary').count(), 0);
    await fee.fill('3');
    await waitForText(page.getByRole('status'), /계산 완료/);

    // Selling to one main stat lowers the chance of reaching each grade.
    const chanceBefore = await results.locator('.flame-equivalent b').first().innerText();
    for (const stat of ['DEX', 'INT', 'LUK']) await main.getByRole('button', { name: stat, exact: true }).click();
    assert.equal(await main.getByRole('button', { name: 'STR', exact: true }).getAttribute('aria-pressed'), 'true');
    await waitForText(page.getByRole('status'), /계산 완료/);
    assert.notEqual(await results.locator('.flame-equivalent b').first().innerText(), chanceBefore);
    assert.match(await results.locator('.ft-recommendation').innerText(), /STR 환산 급수 기준/);

    await main.getByLabel('저장할 프리셋 이름', { exact: true }).fill('STR 추옵');
    await main.getByLabel('저장할 프리셋 이름', { exact: true }).press('Enter');
    await main.getByRole('button', { name: '2번 판매가 조건 삭제', exact: true }).click();
    await main.getByLabel('노작 매입가 (억 메소)', { exact: true }).fill('1');
    const presets = main.getByLabel('저장된 프리셋', { exact: true });
    await presets.selectOption('');
    await presets.selectOption('STR 추옵');
    assert.equal(await main.getByLabel('노작 매입가 (억 메소)', { exact: true }).inputValue(), '2.5');
    assert.equal(await main.getByLabel('2번 판매가 조건의 입력 방식', { exact: true }).inputValue(), 'stats');
    await page.reload();
    await main.waitFor();
    assert.equal(await main.getByLabel('2번 판매가 조건의 주스탯', { exact: true }).inputValue(), '120');
    assert.equal(await main.getByRole('button', { name: 'LUK', exact: true }).getAttribute('aria-pressed'), 'false');
    await waitForText(page.getByRole('status'), /계산 완료/);
  });
});
test('additional trade subtracts reset cost and auction fee for a guaranteed sale', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await configureGuaranteedTrade(page);
    const results = page.getByRole('region', { name: '에디셔널 장사 계산 결과' });
    assert.equal(await results.locator('.at-result-hero strong').innerText(), '8.82억 메소');
    const attempts = results.locator('.at-metric-grid > div').filter({ hasText: '기대 재설정 횟수 · 현재 매물당' });
    assert.equal(await attempts.locator('b').innerText(), '1회');
    const revenue = results.locator('.at-metric-grid > div').filter({ hasText: '수수료 차감 후 판매대금 · 현재 매물당' });
    assert.equal(await revenue.locator('b').innerText(), '9.7억 메소');
    await page.getByLabel('저장할 프리셋 이름', { exact: true }).fill('확정 판매');
    await page.getByLabel('저장할 프리셋 이름', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('저장된 프리셋', { exact: true }).inputValue(), '확정 판매');
    const price = page.getByLabel('공통 1번 가격 조건의 시세 (억 메소)', { exact: true });
    await price.fill('12');
    const presets = page.getByLabel('저장된 프리셋', { exact: true });
    await presets.selectOption('');
    await presets.selectOption('확정 판매');
    assert.equal(await price.inputValue(), '10');
    await page.reload();
    await page.getByRole('heading', { level: 1, name: /에디셔널.*잠재능력 장사/ }).waitFor();
    assert.equal(await price.inputValue(), '10');
    await page.getByLabel('경매장 수수료 (%)', { exact: true }).fill('101');
    await page.getByRole('button', { name: /장사 기대 수익 계산/ }).click();
    await waitForText(page.getByRole('alert'), /수수료/);
  });
});

test('potential summary scales profit to 100 eok in every mode and fits desktop and phone', { timeout: 120_000 }, async () => {
  const saved = {
    level: 200, part: 'heart', itemPriceEok: '3', fee: '3', pity: '0', floorEok: '1.5',
    autoExclude: false, costs: { epic: 2e6, unique: 2e6, legend: 2e6 },
    statPrices: { 'u:STR_12': '20' },
  };
  const cfg = {
    part: 'heart', level: 200, itemPrice: 3e8, fee: 3, floorPrice: 1.5e8,
    autoExclude: false, miracle: false, costs: saved.costs, prime: { on: false },
    targetsU: [{ id: 'STR_12', kind: 'stat', stat: 'STR', min: 12, price: 20e8 }], targetsL: [],
  };
  const eng = solveEngine(cfg);
  await withPage(async page => {
    await open(page, 'potential');
    const cards = page.locator('main:visible .potential-summary-metric');
    const value = cards.filter({ hasText: '100억당 기대 순익' }).locator('.potential-summary-value');
    const assertValue = async (stats, rounds = 1) => {
      // Equal per-reset costs give an independent spending formula.
      const eok = 100 * stats.profit / (rounds * cfg.itemPrice + stats.resets * 2e6);
      const expected = (eok >= 0 ? '+' : '-') + Math.abs(eok).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '억';
      await value.filter({ hasText: expected }).waitFor({ timeout: 60_000 });
      assert.equal(await value.innerText(), expected);
    };
    await assertValue(eng.steady);
    assert.equal(await cards.count(), 5);
    const desktop = await cards.evaluateAll(nodes => nodes.map(node => {
      const { y, width } = node.getBoundingClientRect(); return { y, width };
    }));
    for (const card of desktop) {
      assert.ok(Math.abs(card.y - desktop[0].y) < 1, 'Five desktop cards share one row.');
      assert.ok(Math.abs(card.width - desktop[0].width) < 1, 'Desktop cards have equal widths.');
    }
    await page.getByLabel('현재 유→레 천장 스택 (0~107)', { exact: true }).fill('50');
    await assertValue(eng.round(50));
    await page.getByRole('button', { name: '천장 소모까지 반복', exact: true }).click();
    const camp = campaignStats(eng, 50, cfg.itemPrice);
    await assertValue(camp, camp.rounds);
    await page.setViewportSize({ width: 375, height: 900 });
    await assertNoOverflow(page, 'Potential summary with five cards');
    const mobile = await cards.evaluateAll(nodes => nodes.map(node => {
      const { x, width } = node.getBoundingClientRect(); return { x, width };
    }));
    assert.ok(mobile[4].width > mobile[0].width * 1.9, 'The last mobile card spans both columns.');
    await page.getByLabel('노작 매입가 (억 메소)', { exact: true }).fill('99');
    await waitForText(value, /-/);
    await page.getByLabel('노작 매입가 (억 메소)', { exact: true }).fill('0');
    for (const grade of ['에픽', '유니크', '레전드리']) {
      await page.getByLabel(`${grade} 재설정 비용 (메소)`, { exact: true }).fill('0');
    }
    await waitForText(value, /—/);
  }, {
    data: saved,
    init: settings => localStorage.setItem('mpc:auto:v1', JSON.stringify(settings)),
  });
});

test('potential prices calculate a result and persist through navigation and reload', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'potential');
    const price = page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true });
    await price.fill('10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mpc:auto:v1'))?.statPrices['u:STR_12'] === '10');
    await page.getByRole('navigation').locator('a[href="/flame/"]').click();
    await page.getByRole('heading', { level: 1, name: /추가옵션.*효율 계산기/ }).waitFor();
    await page.getByRole('navigation').locator('a[href="/potential/"]').last().click();
    assert.equal(await price.inputValue(), '10');
    await page.reload();
    await page.getByRole('heading', { level: 1, name: /잠재능력.*장사/ }).waitFor();
    assert.equal(await price.inputValue(), '10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
  });
});

test('potential always includes all-stat lines after restoring old settings and presets', { timeout: 180_000 }, async () => {
  const settings = {
    level: 200, part: 'heart', itemPriceEok: '2.375', fee: '2.75', pity: '0', floorEok: '1.125',
    autoExclude: false, costs: { epic: 17000000, unique: 35000000, legend: 44000000 },
    statPrices: { 'u:STR_12': '11.25', 'u:HP_12': '12.5' },
  };
  const preset = {
    ...settings, level: 160, part: 'cape', itemPriceEok: '1.5', fee: '5', floorEok: '2',
    costs: { epic: 16000000, unique: 33000000, legend: 41000000 },
    statPrices: { 'u:STR_12': '15', 'u:HP_12': '16' },
  };
  async function assertRestored(page, expected) {
    const equipment = page.locator('main:visible .calculator-trade-equipment');
    for (const [label, value] of [
      ['레벨 제한', String(expected.level)], ['착용 부위', expected.part],
      ['노작 매입가 (억 메소)', expected.itemPriceEok], ['경매장 수수료 (%)', expected.fee],
      ['현재 유→레 천장 스택 (0~107)', expected.pity], ['레전 깡통·잡옵 처분가 (억, 폴백용)', expected.floorEok],
    ]) assert.equal(await equipment.getByLabel(label, { exact: true }).inputValue(), value);
    assert.equal(await page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true }).inputValue(), expected.statPrices['u:STR_12']);
    assert.equal(await page.getByLabel('유니크 HP 12% 판매가 (억 메소)', { exact: true }).inputValue(), expected.statPrices['u:HP_12']);
    assert.equal(await page.getByRole('switch', { name: '올스탯 줄을 스탯 합산에 포함', exact: true, includeHidden: true }).count(), 0);
    await page.waitForFunction(expected => {
      const saved = JSON.parse(localStorage.getItem('mpc:auto:v1'));
      return saved?.allstatCount === true && saved.level === expected.level && saved.part === expected.part
        && saved.statPrices['u:STR_12'] === expected.statPrices['u:STR_12'];
    }, expected);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mpc:auto:v1')));
    assert.deepEqual(saved.costs, expected.costs, 'Migrating the all-stat rule must preserve custom reset costs.');
  }
  async function results(page) {
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    return {
      targets: await page.locator('.potential-judgements tbody').innerText(),
      profit: await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).locator('..').innerText(),
      resets: await page.getByText('라운드당 기대 재설정', { exact: true }).locator('..').innerText(),
    };
  }
  const baseline = [];
  for (const allstatCount of [true, false]) {
    await withPage(async page => {
      await open(page, 'potential');
      await assertRestored(page, settings);
      const restoredResult = await results(page);
      if (allstatCount) baseline.push(restoredResult);
      else assert.deepEqual(restoredResult, baseline[0], 'Old false settings must compute the same probabilities and profit as the all-stat baseline.');
      const detail = page.getByRole('button', { name: 'STR 12%', exact: true });
      await detail.click();
      const panelId = await detail.getAttribute('aria-controls');
      assert.match(await page.locator(`[id="${panelId}"]`).innerText(), /(?:STR\+6% · 올스탯\+6%|올스탯\+6% · STR\+6%)/,
        'A stat target must include combinations that reach its threshold through all-stat lines.');
      await detail.click();

      // Change an input so applying the preset must restore a separate snapshot.
      await page.getByLabel('노작 매입가 (억 메소)', { exact: true }).fill('99');
      await page.getByLabel('저장된 프리셋', { exact: true }).selectOption('이전 올스탯 설정');
      await assertRestored(page, preset);
      const presetResult = await results(page);
      if (allstatCount) baseline.push(presetResult);
      else assert.deepEqual(presetResult, baseline[1], 'Applying an old false preset must retain the always-on all-stat calculation.');
      await page.reload();
      await page.getByRole('heading', { level: 1, name: /잠재능력.*장사/ }).waitFor();
      await assertRestored(page, preset);
      assert.deepEqual(await results(page), presetResult, 'The migrated rule and deterministic results must survive reload.');
    }, {
      data: { settings: { ...settings, allstatCount }, preset: { ...preset, allstatCount } },
      init: ({ settings, preset }) => {
        if (!localStorage.getItem('mpc:auto:v1')) localStorage.setItem('mpc:auto:v1', JSON.stringify(settings));
        if (!localStorage.getItem('mpc:presets:v1')) localStorage.setItem('mpc:presets:v1', JSON.stringify({ '이전 올스탯 설정': preset }));
      },
    });
  }
});

test('potential rejects blank, negative and excessive auction fees', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'potential');
    await page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true }).fill('10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    for (const value of ['', '-1', '101']) {
      await page.getByLabel('경매장 수수료 (%)', { exact: true }).fill(value);
      await waitForText(page.getByRole('alert'), /수수료/);
    }
  });
});

test('potential validates the selected level while preserving prices for other levels', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'potential');
    const oldPrice = page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true });
    await oldPrice.fill('-1');
    await waitForText(page.getByRole('alert'), /판매가/);
    await page.getByLabel('레벨 제한', { exact: true }).selectOption('250');
    await page.getByLabel('유니크 STR 14% 판매가 (억 메소)', { exact: true }).fill('10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    assert.equal(await page.getByRole('alert').count(), 0, 'A hidden price from another item level must not block this calculation.');
    await page.getByLabel('레벨 제한', { exact: true }).selectOption('200');
    assert.equal(await oldPrice.inputValue(), '-1', 'Switching levels must preserve the previous price bank.');
    await waitForText(page.getByRole('alert'), /판매가/);
  });
});

test('potential switches and navigation are operable by keyboard', async () => {
  await withPage(async page => {
    await open(page, 'potential');
    const toggle = page.getByRole('switch', { name: '미라클데이 (등급업 확률 ×2)', exact: true });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.focus();
    await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true }).fill('10');
    const detail = page.getByRole('button', { name: 'STR 12%', exact: true });
    await detail.waitFor({ timeout: 60_000 });
    assert.equal(await detail.getAttribute('aria-expanded'), 'false');
    await detail.press('Enter');
    assert.equal(await detail.getAttribute('aria-expanded'), 'true');
    const panelId = await detail.getAttribute('aria-controls');
    const panel = page.locator(`[id="${panelId}"]`);
    await panel.waitFor();
    assert.match(await panel.innerText(), /구간 도달 조합/);
    await detail.press('Space');
    assert.equal(await detail.getAttribute('aria-expanded'), 'false');
    await panel.waitFor({ state: 'detached' });
    const link = page.getByRole('navigation').locator('a[href="/flame/"]');
    await link.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { level: 1, name: /추가옵션.*효율 계산기/ }).waitFor();
  });
});

test('blocked browser storage does not prevent any calculator from loading', async () => {
  await withPage(async page => {
    for (const route of routes) await open(page, route.path);
  }, {
    init: () => Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage is disabled', 'SecurityError'); },
    }),
  });
});

test('malformed potential settings and presets recover without a blank page', async () => {
  for (const settings of [
    { part: 'hat', hatRows: 'bad' },
    { part: 'hat', hatRows: [null] },
    { part: 'unknown', level: 999, costs: [], statPrices: [], accPrices: null },
  ]) {
    await withPage(async page => {
      await open(page, 'potential');
      assert.ok(await page.getByRole('spinbutton').count() > 0);
      await page.getByRole('navigation').locator('a[href="/flame/"]').click();
      await page.getByRole('heading', { level: 1, name: /추가옵션.*효율 계산기/ }).waitFor();
    }, {
      data: settings,
      init: data => {
        localStorage.setItem('mpc:auto:v1', JSON.stringify(data));
        localStorage.setItem('mpc:presets:v1', JSON.stringify([null, 'bad']));
      },
    });
  }
});

test('potential presets restore an intentionally empty special price list', async () => {
  await withPage(async page => {
    await open(page, 'potential');
    await page.getByLabel('착용 부위', { exact: true }).selectOption('hat');
    const remove = page.getByRole('button', { name: /모자 \d+번 조합 삭제/ });
    assert.ok(await remove.count() > 0);
    while (await remove.count()) await remove.first().click();
    await page.getByLabel('저장할 프리셋 이름', { exact: true }).fill('빈 모자 조건');
    await page.getByRole('button', { name: '현재 입력 저장', exact: true }).click();
    await page.getByRole('button', { name: /조합 추가/ }).click();
    assert.equal(await remove.count(), 1);
    const presets = page.getByLabel('저장된 프리셋', { exact: true });
    await presets.selectOption('');
    await presets.selectOption('빈 모자 조건');
    assert.equal(await remove.count(), 0);
  });
});

const flameNormalProfile = (overrides = {}) => ({
  itemLevel: 200,
  current: { main: 100, sub: 0, attack: 0, all: 5 },
  efficiencies: { main: 1, sub: 0.1, attack: 3, all: 1.1 },
  mesoPerPercent: 100_000_000,
  ...overrides,
});
const flameXenonProfile = (overrides = {}) => ({
  itemLevel: 200,
  current: { STR: 36, DEX: 72, LUK: 36, attack: 5, all: 6 },
  efficiencies: { STR: 0.5, DEX: 0.5, LUK: 0.5, attack: 2.5, all: 1 },
  mesoPerPercent: 100_000_000,
  ...overrides,
});
const flameV2 = (mode = 'normal', profiles = {}) => ({
  mode,
  profiles: {
    normal: flameNormalProfile(),
    xenon: flameXenonProfile(),
    ...profiles,
  },
});
const trackingWorkers = () => {
  window.calculationWorkers = [];
  window.Worker = class {
    constructor() { this.messages = []; this.terminated = false; window.calculationWorkers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  };
};

test('flame mode controls invalidate the old calculation and require an explicit Xenon recalculation', async () => {
  await withPage(async page => {
    await open(page, 'flame');
    const modes = page.getByRole('group', { name: '계산 모드', exact: true });
    const normal = modes.getByRole('button', { name: '일반', exact: true });
    const xenon = modes.getByRole('button', { name: '제논', exact: true });
    assert.equal(await modes.getByRole('button').count(), 2, 'The flame calculator has only normal and Xenon modes.');
    assert.equal(await normal.getAttribute('aria-pressed'), 'true');
    assert.equal(await xenon.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByLabel('아이템의 레벨 제한', { exact: true }).count(), 1);

    await xenon.click();
    assert.equal(await normal.getAttribute('aria-pressed'), 'false');
    assert.equal(await xenon.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.calculationWorkers[0].terminated), true,
      'Switching modes must terminate the active normal calculation.');
    assert.equal(await page.evaluate(() => window.calculationWorkers.length), 1,
      'Switching modes must not start a replacement calculation automatically.');

    const calculate = page.getByRole('button', { name: /멈출 추가옵션 계산/ });
    assert.equal(await calculate.isVisible(), true);
    await calculate.click();
    await page.waitForFunction(() => window.calculationWorkers.length === 2);
    assert.equal(await page.evaluate(() => window.calculationWorkers[1].messages[0].settings.mode), 'xenon');
  }, { init: trackingWorkers });
});

test('Xenon flame uses all five reference inputs and keeps the result terminology consistent on mobile', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'flame');
    await waitForText(page.getByRole('status'), /계산 완료/);
    const modes = page.getByRole('group', { name: '계산 모드', exact: true });
    await modes.getByRole('button', { name: '제논', exact: true }).click();
    const inputs = {
      STR: ['현재 추가옵션 STR', 'STR 10의 올스탯 환산 효율 (%)', '36', '0.5'],
      DEX: ['현재 추가옵션 DEX', 'DEX 10의 올스탯 환산 효율 (%)', '72', '0.5'],
      LUK: ['현재 추가옵션 LUK', 'LUK 10의 올스탯 환산 효율 (%)', '36', '0.5'],
      attack: ['현재 추가옵션 공격력', '공격력 10의 올스탯 환산 효율 (%)', '5', '2.5'],
      all: ['현재 추가옵션 올스탯', '올스탯 1%의 올스탯 환산 효율 (%)', '6', '1'],
    };
    for (const [currentLabel, efficiencyLabel, currentValue, efficiencyValue] of Object.values(inputs)) {
      assert.equal(await page.getByLabel(currentLabel, { exact: true }).inputValue(), currentValue);
      assert.equal(await page.getByLabel(efficiencyLabel, { exact: true }).inputValue(), efficiencyValue);
    }
    const allStat = page.getByLabel('현재 추가옵션 올스탯', { exact: true });
    assert.equal(await allStat.evaluate(input => input.readOnly), false,
      'The current all-stat option amount remains editable.');
    assert.equal(await page.getByLabel(inputs.all[1], { exact: true }).evaluate(input => input.readOnly), true,
      'The all-stat conversion unit is fixed at one all-stat percent.');
    assert.equal(await page.getByLabel('환산 올스탯 1%당 지불할 최대 금액 (억 메소)', { exact: true }).count(), 1);
    assert.match(await page.locator('.flame-current-score').innerText(), /289급/);
    assert.equal(await page.locator('.flame-recommendation').count(), 0,
      'Changing mode must clear the previous normal result.');
    await assertNoOverflow(page, 'Xenon flame settings at 375px');

    await page.getByLabel(inputs.DEX[1], { exact: true }).fill('0.6');
    await page.getByRole('button', { name: /멈출 추가옵션 계산/ }).click();
    await waitForText(page.getByRole('status'), /계산 완료/);
    const result = page.getByRole('region', { name: '추가옵션 종료 기준 계산 결과' });
    assert.match(await result.innerText(), /환산 올스탯\s*%/,
      'Unequal STR/DEX/LUK efficiencies must use the all-stat-equivalent label instead of grade.');
    assert.doesNotMatch(await result.innerText(), /\d+(?:\.\d+)?급/);
    await assertNoOverflow(page, 'Xenon flame result at 375px');
  }, {
    viewport: { width: 375, height: 812 },
    init: data => {
      window.localStorage.setItem('maple:flame:settings:v2', JSON.stringify(data));
    },
    data: flameV2('normal'),
  });
});

test('Xenon flame auto-calculates when restored as the active mode using the embedded production worker', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'flame');
    await waitForText(page.getByRole('status'), /계산 완료/);
    assert.equal(await page.getByRole('group', { name: '계산 모드' }).getByRole('button', { name: '제논' }).getAttribute('aria-pressed'), 'true');
    const results = page.getByRole('region', { name: '추가옵션 종료 기준 계산 결과' });
    assert.equal(await results.count(), 1);
    assert.match(await results.innerText(), /제논 환산 급수/);
    assert.match(await results.innerText(), /이런 추가옵션이면 멈추세요/);
    assert.equal(await results.locator('table thead th').count(), 6,
      'The production worker result examples must contain the five Xenon option columns and the converted score.');
    assert.match(await results.locator('table thead').innerText(), /STR|주스텟/);
    assert.match(await results.locator('table thead').innerText(), /DEX|부스텟/);
    assert.match(await results.locator('table thead').innerText(), /공격력/);
    assert.match(await results.locator('table thead').innerText(), /올스탯/);
  }, {
    init: data => localStorage.setItem('maple:flame:settings:v2', JSON.stringify(data)),
    data: flameV2('xenon'),
  });
});

test('flame v1 settings migrate and both normal and Xenon profiles persist independently', async () => {
  const legacy = flameNormalProfile({
    itemLevel: 250,
    current: { main: 123, sub: 45, attack: 12, all: 8 },
    efficiencies: { main: 1.2, sub: 0.2, attack: 4, all: 1.3 },
    mesoPerPercent: 250_000_000,
  });
  await withPage(async page => {
    await open(page, 'flame');
    await page.waitForFunction(key => {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved?.mode === 'normal' && saved?.profiles?.normal?.current?.main === 123;
    }, 'maple:flame:settings:v2');
    assert.equal(await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).inputValue(), '123');
    assert.equal(await page.getByLabel('아이템의 레벨 제한', { exact: true }).inputValue(), '250');
    assert.equal(await page.getByLabel('주스텟 1%당 지불할 최대 금액 (억 메소)', { exact: true }).inputValue(), '2.5');

    await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).fill('');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.profiles?.normal?.current?.main === '', 'maple:flame:settings:v2');
    assert.equal(await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).inputValue(), '');
    await page.getByLabel('아이템의 레벨 제한', { exact: true }).fill('');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.profiles?.normal?.itemLevel === '', 'maple:flame:settings:v2');
    await page.reload();
    await page.getByRole('heading', { level: 1, name: routes.find(candidate => candidate.path === 'flame').heading }).waitFor();
    assert.equal(await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).inputValue(), '', 'Blank numeric drafts must survive reload.');
    assert.equal(await page.getByLabel('아이템의 레벨 제한', { exact: true }).inputValue(), '', 'A blank level draft must survive reload.');
  }, {
    init: (data) => {
      localStorage.setItem('maple:flame:settings:v1', JSON.stringify(data));
      window.calculationWorkers = [];
      window.Worker = class {
        constructor() { this.messages = []; this.terminated = false; window.calculationWorkers.push(this); }
        postMessage(message) { this.messages.push(message); }
        terminate() { this.terminated = true; }
      };
    },
    data: legacy,
  });

  await withPage(async page => {
    await open(page, 'flame');
    const modes = page.getByRole('group', { name: '계산 모드', exact: true });
    await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).fill('111');
    await page.getByLabel('아이템의 레벨 제한', { exact: true }).fill('240');
    await page.getByLabel('주스텟 1%당 지불할 최대 금액 (억 메소)', { exact: true }).fill('3.75');
    await modes.getByRole('button', { name: '제논', exact: true }).click();
    await page.getByLabel('현재 추가옵션 STR', { exact: true }).fill('42');
    await page.getByLabel('DEX 10의 올스탯 환산 효율 (%)', { exact: true }).fill('0.7');
    await page.getByLabel('아이템의 레벨 제한', { exact: true }).fill('230');
    await page.getByLabel('환산 올스탯 1%당 지불할 최대 금액 (억 메소)', { exact: true }).fill('4.5');
    await page.waitForFunction(key => {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved?.mode === 'xenon' && saved.profiles?.normal?.current?.main === 111
        && saved.profiles?.xenon?.current?.STR === 42;
    }, 'maple:flame:settings:v2');
    await modes.getByRole('button', { name: '일반', exact: true }).click();
    assert.equal(await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).inputValue(), '111');
    assert.equal(await page.getByLabel('아이템의 레벨 제한', { exact: true }).inputValue(), '240');
    assert.equal(await page.getByLabel('주스텟 1%당 지불할 최대 금액 (억 메소)', { exact: true }).inputValue(), '3.75');
    await page.reload();
    await page.getByRole('heading', { level: 1, name: routes.find(candidate => candidate.path === 'flame').heading }).waitFor();
    await page.getByRole('group', { name: '계산 모드' }).getByRole('button', { name: '일반' }).waitFor();
    await page.getByRole('group', { name: '계산 모드' }).getByRole('button', { name: '제논' }).click();
    assert.equal(await page.getByLabel('현재 추가옵션 STR', { exact: true }).inputValue(), '42');
    assert.equal(await page.getByLabel('DEX 10의 올스탯 환산 효율 (%)', { exact: true }).inputValue(), '0.7');
    assert.equal(await page.getByLabel('아이템의 레벨 제한', { exact: true }).inputValue(), '230');
    assert.equal(await page.getByLabel('환산 올스탯 1%당 지불할 최대 금액 (억 메소)', { exact: true }).inputValue(), '4.5');
  }, { init: trackingWorkers });
});

test('flame negative inputs render safely and show validation when recalculated', async () => {
  for (const [label, value] of [
    ['현재 추가옵션 주스텟', '-1'],
    ['주스텟 환산 효율 (%)', '-1'],
  ]) {
    await withPage(async page => {
      await open(page, 'flame');
      const input = label === '주스텟 환산 효율 (%)'
        ? page.getByLabel('주스텟 10의 주스텟 환산 효율 (%)', { exact: true })
        : page.getByLabel(label, { exact: true });
      await input.fill(value);
      assert.match(await page.locator('.flame-current-score').innerText(), /—/,
        `${label}: the preview must show a dash for an invalid negative value.`);
      assert.equal(await page.getByRole('heading', { level: 1, name: routes.find(candidate => candidate.path === 'flame').heading }).count(), 1,
        'Invalid preview input must not unmount the page.');
      await page.getByRole('button', { name: /멈출 추가옵션 계산/ }).click();
      await waitForText(page.getByRole('alert'), /0 이상의 숫자/);
    }, { init: trackingWorkers });
  }
});

test('Xenon flame negative inputs keep the page mounted and validate on recalculation', async () => {
  for (const [label, value] of [
    ['현재 추가옵션 STR', '-1'],
    ['STR 10의 올스탯 환산 효율 (%)', '-1'],
  ]) {
    await withPage(async page => {
      await open(page, 'flame');
      await page.getByRole('group', { name: '계산 모드' }).getByRole('button', { name: '제논' }).click();
      await page.getByLabel(label, { exact: true }).fill(value);
      assert.match(await page.locator('.flame-current-score').innerText(), /—/,
        `${label}: the Xenon preview must show a dash for an invalid negative value.`);
      assert.equal(await page.getByRole('heading', { level: 1, name: routes.find(candidate => candidate.path === 'flame').heading }).count(), 1,
        'Invalid Xenon preview input must not unmount the page.');
      await page.getByRole('button', { name: /멈출 추가옵션 계산/ }).click();
      await waitForText(page.getByRole('alert'), /0 이상의 숫자/);
    }, { init: trackingWorkers });
  }
});

test('flame settings parse v2 and legacy storage independently', async () => {
  const validV1 = flameNormalProfile({ current: { main: 137, sub: 22, attack: 8, all: 4 } });
  await withPage(async page => {
    await open(page, 'flame');
    assert.equal(await page.getByLabel('현재 추가옵션 주스텟', { exact: true }).inputValue(), '137',
      'Corrupt v2 JSON must fall back to a valid v1 record.');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.profiles?.normal?.current?.main === 137, 'maple:flame:settings:v2');
  }, {
    init: data => {
      localStorage.setItem('maple:flame:settings:v2', '{bad json');
      localStorage.setItem('maple:flame:settings:v1', JSON.stringify(data));
      window.calculationWorkers = [];
      window.Worker = class {
        constructor() { this.messages = []; this.terminated = false; window.calculationWorkers.push(this); }
        postMessage(message) { this.messages.push(message); }
        terminate() { this.terminated = true; }
      };
    },
    data: validV1,
  });

  const validV2 = flameV2('xenon', {
    xenon: flameXenonProfile({ current: { STR: 51, DEX: 62, LUK: 73, attack: 4, all: 3 } }),
  });
  await withPage(async page => {
    await open(page, 'flame');
    assert.equal(await page.getByRole('group', { name: '계산 모드' }).getByRole('button', { name: '제논' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('현재 추가옵션 STR', { exact: true }).inputValue(), '51',
      'Corrupt legacy JSON must not prevent a valid v2 profile from loading.');
  }, {
    init: data => {
      localStorage.setItem('maple:flame:settings:v2', JSON.stringify(data));
      localStorage.setItem('maple:flame:settings:v1', '{bad json');
      window.calculationWorkers = [];
      window.Worker = class {
        constructor() { this.messages = []; this.terminated = false; window.calculationWorkers.push(this); }
        postMessage(message) { this.messages.push(message); }
        terminate() { this.terminated = true; }
      };
    },
    data: validV2,
  });
});

test('potential hat combinations accept an all-stat companion and keep it after reload', async () => {
  await withPage(async page => {
    await open(page, 'potential');
    const main = page.locator('main:visible');
    await main.getByLabel('착용 부위', { exact: true }).selectOption('hat');
    const stat = main.getByLabel('모자 1번 조합의 주스탯', { exact: true });
    assert.deepEqual(await stat.locator('option').allInnerTexts(), ['STR', 'DEX', 'INT', 'LUK', '올스탯']);
    await stat.selectOption('ALL');
    const minimum = main.getByLabel('모자 1번 조합의 최소 스탯 (%)', { exact: true });
    await minimum.selectOption('15');
    await main.getByLabel('모자 1번 조합의 판매가 (억 메소)', { exact: true }).fill('30');
    await waitForText(main, /쿨감 2초↑ \+ 올스탯 15%↑/);
    await page.waitForFunction(() => {
      const row = JSON.parse(localStorage.getItem('mpc:auto:v1') || '{}').hatRows?.[0];
      return row?.stat === 'ALL' && row.statMin === 15 && row.price === '30';
    });
    await page.reload();
    await main.getByLabel('모자 1번 조합의 주스탯', { exact: true }).waitFor();
    assert.equal(await stat.inputValue(), 'ALL');
    assert.equal(await minimum.inputValue(), '15');
    await main.getByLabel('착용 부위', { exact: true }).selectOption('glove');
    assert.equal(await main.getByLabel('장갑 1번 조합의 주스탯', { exact: true }).locator('option').filter({ hasText: '올스탯' }).count(), 0);
  });
});
