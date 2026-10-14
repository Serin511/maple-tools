import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const routes = [
  { path: 'potential', heading: /잠재능력.*장사/, title: '잠재능력 장사 | 메이플 계산기' },
  { path: 'additional-trade', heading: /에디셔널.*잠재능력 장사/, title: '에디셔널 잠재능력 장사 | 메이플 계산기' },
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
    const html = await readFile(new URL('../../dist/index.html', import.meta.url));
    server = createServer((request, response) => {
      if (request.url?.split('?')[0] === '/favicon.ico') {
        response.writeHead(204).end();
      } else if (request.url?.split('?')[0] === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      } else {
        response.writeHead(404).end();
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
  await page.goto(`${origin}/#/${path}`);
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

test('all calculator routes expose their title, current navigation and one main landmark', async () => {
  await withPage(async page => {
    await open(page, 'potential');
    let sharedTypography;
    for (const route of routes) {
      const navigation = page.getByRole('navigation', { name: '계산기 페이지' });
      // Use the menu link, as the potential route also has a brand link.
      const link = navigation.locator(`a[href="#/${route.path}"]`).last();
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

async function configureGuaranteedTrade(page) {
  await open(page, 'additional-trade');
  await page.getByLabel('재설정 시작 등급', { exact: true }).selectOption('레전드리');
  await page.getByRole('button', { name: /가격 조건 추가/ }).click();
  await page.getByLabel('공통 1번 가격 조건의 최소 스탯 환산 (%)', { exact: true }).fill('0');
  await page.getByLabel('공통 1번 가격 조건의 시세 (억 메소)', { exact: true }).fill('10');
  await page.getByRole('button', { name: /장사 기대 수익 계산/ }).click();
  await waitForText(page.getByRole('status'), /계산 완료/);
}

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

test('potential prices calculate a result and persist through navigation and reload', { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await open(page, 'potential');
    const price = page.getByLabel('유니크 STR 12% 판매가 (억 메소)', { exact: true });
    await price.fill('10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mpc:auto:v1'))?.statPrices['u:STR_12'] === '10');
    await page.getByRole('navigation').locator('a[href="#/flame"]').click();
    await page.getByRole('heading', { level: 1, name: /추가옵션.*효율 계산기/ }).waitFor();
    await page.getByRole('navigation').locator('a[href="#/potential"]').last().click();
    assert.equal(await price.inputValue(), '10');
    await page.reload();
    await page.getByRole('heading', { level: 1, name: /잠재능력.*장사/ }).waitFor();
    assert.equal(await price.inputValue(), '10');
    await page.getByText('라운드당 기대 순익 (장기)', { exact: true }).waitFor({ timeout: 60_000 });
  });
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
    const link = page.getByRole('navigation').locator('a[href="#/flame"]');
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
      await page.getByRole('navigation').locator('a[href="#/flame"]').click();
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
