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
];

test('trading equipment panels share the potential workflow and full-width controls on desktop and phone', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    await withPage(async page => {
      for (const fields of tradeEquipment) {
        await open(page, fields.path);
        const panel = page.locator('main:visible .calculator-trade-equipment');
        assert.equal(await panel.count(), 1);
        assert.equal(await panel.getByRole('heading', { level: 2, name: '장비 설정', exact: true }).count(), 1);
        const expectedOrder = [fields.purchase, fields.level, fields.part, ...(fields.grade ? [fields.grade] : []),
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
  for (const fields of tradeEquipment) {
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
