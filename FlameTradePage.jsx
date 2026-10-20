import { useEffect, useId, useRef, useState } from 'react';
import { CalculatorHeader, CalculatorFooter, CalculatorCard, CalculateButton, NumericField, PresetControls, TradeEquipmentSettings, TradeResetCostSettings, ToggleField } from './ui.jsx';
import { TradePriceEditor } from './TradePriceEditor.jsx';
import {
  DEFAULT_FLAME_TRADE_SETTINGS, DEFAULT_FLAME_TRADE_WEIGHTS, FLAME_TRADE_LEVELS, FLAME_TRADE_ROW_LABELS, FLAME_TRADE_ROW_STATS,
  FLAME_TRADE_FLOOR_ID, FLAME_TRADE_STATS, flameTradeRowScore, newFlameTradeRow, validateFlameTradeSettings,
} from './flame-trade-calculator.mjs';
import { FLAME_SOURCES } from './flame-data.mjs';
import './flame.css';
import './flame-trade.css';

const SAVE_KEY = 'maple:flame-trade:settings:v1';
const PRESET_KEY = 'maple:flame-trade:presets:v1';
const copy = value => JSON.parse(JSON.stringify(value));
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
const grade = value => `${number(value, 2)}급`;
const probability = value => {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0%';
  const pct = value * 100;
  return `${pct < 0.001 ? pct.toExponential(2) : number(pct, pct < 0.1 ? 4 : 2)}%`;
};
const meso = value => {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e8) return `${number(value / 1e8)}억 메소`;
  if (Math.abs(value) >= 1e4) return `${number(value / 1e4, 0)}만 메소`;
  return `${number(value, 0)} 메소`;
};
const signed = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${meso(value)}` : '—';
const tone = value => !Number.isFinite(value) ? '' : value >= 0 ? 'ft-positive' : 'ft-negative';
const weightFields = [
  { key: 'sub', label: '부스탯 1' },
  { key: 'attack', label: '공격력·마력 1' },
  { key: 'all', label: '올스탯 1%' },
];

const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
// Blank inputs stay blank so validation can report them instead of using 0.
const editable = (value, fallback) => value === '' || (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : fallback;
const rowId = () => `flame-price-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  const ids = new Set();
  return rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)).map(row => {
    const id = typeof row.id === 'string' && row.id && !ids.has(row.id) ? row.id : rowId();
    ids.add(id);
    return newFlameTradeRow(id, {
      mode: row.mode === 'stats' ? 'stats' : 'total',
      total: editable(row.total, ''),
      ...Object.fromEntries(FLAME_TRADE_ROW_STATS.map(key => [key, editable(row[key], 0)])),
      price: editable(row.price, ''),
    });
  });
}

export function normalizeFlameTradeSettings(saved) {
  const defaults = DEFAULT_FLAME_TRADE_SETTINGS;
  saved = record(saved);
  const weights = record(saved.weights);
  const mainStats = Array.isArray(saved.mainStats) ? FLAME_TRADE_STATS.filter(stat => saved.mainStats.includes(stat)) : [];
  return {
    level: FLAME_TRADE_LEVELS.includes(saved.level) ? saved.level : defaults.level,
    itemPrice: editable(saved.itemPrice, defaults.itemPrice),
    fee: editable(saved.fee, defaults.fee),
    floorPrice: editable(saved.floorPrice, defaults.floorPrice),
    resetCost: editable(saved.resetCost, defaults.resetCost),
    autoSell: typeof saved.autoSell === 'boolean' ? saved.autoSell : defaults.autoSell,
    mainStats: mainStats.length ? mainStats : [...defaults.mainStats],
    weights: Object.fromEntries(weightFields.map(({ key }) => [key, editable(weights[key], defaults.weights[key])])),
    prices: cleanRows(saved.prices),
  };
}

function loadPresets() {
  return Object.fromEntries(Object.entries(record(readJSON(PRESET_KEY, {})))
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)));
}

function rowGrade(row, weights) {
  const values = row.mode === 'total' ? [row.total] : [...FLAME_TRADE_ROW_STATS.map(key => row[key]), ...weightFields.map(({ key }) => weights[key])];
  return values.every(value => typeof value === 'number' && Number.isFinite(value)) ? flameTradeRowScore(row, weights) : null;
}

function MainStatSelector({ selected, onChange }) {
  const labelId = useId();
  return <div className="ft-stat-targets">
    <span id={labelId}>판매 대상 주스탯</span>
    <div className="ft-stat-buttons" role="group" aria-labelledby={labelId}>
      {FLAME_TRADE_STATS.map(stat => <button type="button" key={stat} aria-pressed={selected.includes(stat)}
        onClick={() => onChange(selected.includes(stat) ? selected.filter(item => item !== stat) : FLAME_TRADE_STATS.filter(item => item === stat || selected.includes(item)))}>{stat}</button>)}
    </div>
    <span className="calculator-trade-help">직업군 전용 장비는 해당 주스탯만 선택하세요. 여러 개를 고르면 가장 높은 환산 급수로 판매합니다.</span>
  </div>;
}

function WeightSettings({ weights, onChange }) {
  return <CalculatorCard as="div" className="ft-weight-card">
    <div className="flame-section-title"><h2>추가옵션 환산표</h2>
      <button className="flame-text-button" type="button" onClick={() => onChange({ ...DEFAULT_FLAME_TRADE_WEIGHTS })}>기본값</button></div>
    <p className="flame-muted">각 수치가 주스탯 몇 급에 해당하는지 입력하세요. 판매가 조건과 재설정 결과를 모두 이 표로 환산합니다.</p>
    <div className="ft-weights">
      <div className="ft-weight-fixed"><span>주스탯 1</span><span className="flame-equal" aria-hidden="true">=</span><b>1급</b></div>
      {weightFields.map(field => <label key={field.key}><span>{field.label}</span><span className="flame-equal" aria-hidden="true">=</span>
        <NumericField label={`추가옵션 환산표: ${field.label}의 급수`} value={weights[field.key]} unit="급"
          onChange={value => onChange({ ...weights, [field.key]: value })} /></label>)}
    </div>
    <p className="flame-small-note">기본값은 추가옵션 효율 계산기의 기본 효율(주스탯 10 = 1%, 부스탯 10 = 0.1%, 공격력·마력 10 = 3%, 올스탯 1% = 1.1%)과 같은 비율입니다. 거래 시장에서 쓰는 환산 기준이 다르면 바꿔 입력하세요.</p>
  </CalculatorCard>;
}

function PriceRow({ row, index, weights, onChange, onRemove }) {
  const name = `${index + 1}번 판매가 조건`;
  const value = rowGrade(row, weights);
  return <div className={`ft-price-row ft-mode-${row.mode}`}>
    <label className="ft-row-mode"><span>추가옵션 수치</span>
      <select aria-label={`${name}의 입력 방식`} value={row.mode} onChange={event => onChange({ mode: event.target.value })}>
        <option value="total">환산 급수 합계</option>
        <option value="stats">스탯별 입력</option>
      </select></label>
    {row.mode === 'total'
      ? <label className="ft-row-value"><span>환산 급수</span>
        <NumericField label={`${name}의 추가옵션 환산 급수`} value={row.total} unit="급 이상" onChange={total => onChange({ total })} /></label>
      : <div className="ft-row-value ft-stat-values">
        {FLAME_TRADE_ROW_STATS.map(key => <label key={key}><span>{FLAME_TRADE_ROW_LABELS[key]}</span>
          <NumericField label={`${name}의 ${FLAME_TRADE_ROW_LABELS[key]}`} value={row[key]} unit={key === 'all' ? '%' : undefined}
            onChange={amount => onChange({ [key]: amount })} /></label>)}
      </div>}
    <label className="ft-row-price"><span>판매가</span>
      <NumericField label={`${name}의 판매가 (억 메소)`} value={row.price} scale={1e-8} unit="억 메소" onChange={price => onChange({ price })} /></label>
    <button type="button" className="ft-row-remove trade-price-remove" aria-label={`${name} 삭제`} onClick={onRemove}>삭제</button>
    {row.mode === 'stats' && <p className="ft-row-grade">환산 <b>{value === null ? '—' : grade(value)}</b> 이상</p>}
  </div>;
}

function Recommendation({ result, mainStats }) {
  const reachable = result.rows.filter(row => row.decision !== 'unreachable');
  const holds = reachable.some(row => row.decision === 'hold');
  const statText = mainStats.length > 1 ? `${mainStats.join('·')} 중 가장 높은 환산 급수 기준` : `${mainStats[0]} 환산 급수 기준`;
  return <CalculatorCard as="div" className="flame-card flame-recommendation ft-recommendation">
    <div className="flame-section-title"><span className="flame-pill">추천 판매 기준</span><span>{statText}</span></div>
    {result.sellsFloor
      ? <div className="flame-no-budget">첫 재설정 결과를<br /><strong>잡추옵 처분가로 판매</strong></div>
      : result.sellFrom !== null
        ? <div className="flame-threshold"><strong>{number(result.sellFrom, 2)}<small>급</small></strong><span>이상이 나오면 판매</span></div>
        : <div className="flame-no-budget">아래 판정 표의<br /><strong>구간별 판매 판정을 따르세요</strong></div>}
    <p className="flame-equivalent">1회 재설정에서 판매할 결과가 나올 확률은 <b>{probability(result.metrics.acceptanceProbability)}</b>이며, 평균 <b>{number(result.metrics.expectedResets, 1)}회</b> 재설정합니다.</p>
    <div className="flame-action"><span className="flame-action-symbol" aria-hidden="true">{result.metrics.expectedProfit >= 0 ? '↻' : '!'}</span><div>
      <span>{result.objective === 'manual' ? '가격 조건 즉시 판매' : '판매·재설정 자동 최적화'}</span>
      <h2>{result.metrics.expectedProfit >= 0 ? '매물마다 기대 이익' : '기대 손실 장사'}</h2>
      <p>{result.objective === 'manual'
        ? '판매가를 입력한 조건에 도달하면 바로 판매합니다. 각 결과는 도달한 가장 높은 기준의 가격으로 판매합니다.'
        : result.objective === 'per-item'
          ? '어떤 판매 기준도 재설정 비용과 매입가를 회수하지 못합니다. 매물당 기대 손실이 가장 작은 기준을 표시합니다.'
          : holds
            ? '수수료를 뺀 판매가가 노작 매입가보다 높으면 바로 팔고 새 노작을 재설정하는 편이 재설정 1회당 이득이 큽니다. 그보다 낮은 구간은 계속 재설정합니다.'
            : '수수료를 뺀 판매가가 노작 매입가보다 높은 모든 구간에서 바로 판매합니다. 재설정 1회당 기대 이득이 가장 큰 기준입니다.'}</p>
    </div></div>
  </CalculatorCard>;
}

function Summary({ result }) {
  const { metrics, comparison } = result;
  const items = [
    ['재설정 1회당 기대 이득', signed(metrics.profitPerReset), tone(metrics.profitPerReset)],
    ['매물당 기대 순익', signed(metrics.expectedProfit), tone(metrics.expectedProfit)],
    ['매물당 기대 재설정', `${number(metrics.expectedResets, 1)}회`, ''],
    ['손익분기 노작 매입가', metrics.breakevenItemPrice > 0 ? meso(metrics.breakevenItemPrice) : '이익 불가', ''],
    ['100억당 기대 순익', metrics.profitPer100Eok === null ? '—' : signed(metrics.profitPer100Eok), tone(metrics.profitPer100Eok)],
  ];
  return <CalculatorCard as="section" className="flame-card ft-summary" aria-label="추가옵션 장사 기대 수익">
    <div className="flame-section-title"><h2>매물 1개 기대 결과</h2><span>정확 해석 · 평균값</span></div>
    <div className="ft-summary-grid">{items.map(([label, value, className]) => <div key={label} className="ft-summary-metric">
      <span>{label}</span><b className={className}>{value}</b></div>)}</div>
    <div className="ft-detail-grid">
      <div><span>기대 판매가 (수수료 전)</span><b>{meso(metrics.expectedGrossRevenue)}</b></div>
      <div><span>수수료 차감 후 판매대금</span><b>{meso(metrics.expectedNetRevenue)}</b></div>
      <div><span>기대 재설정 비용</span><b>{meso(metrics.expectedResetCost)}</b></div>
    </div>
    <p className="flame-small-note">매물당 순익 = 수수료 차감 후 판매대금 − 노작 매입가 − 재설정 비용. 100억당 기대 순익 = 매물당 순익 ÷ (매입가 + 기대 재설정 비용) × 100억이며, 투입금이 0이면 —로 표시합니다. 손익분기 매입가는 이 가격보다 싸게 사면 기대 순익이 0보다 커지는 매입가입니다.</p>
    {comparison && <p className="flame-small-note">가격 조건에 도달하는 즉시 판매할 때: 재설정 1회당 <b>{signed(comparison.metrics.profitPerReset)}</b> · 매물당 <b>{signed(comparison.metrics.expectedProfit)}</b> · 평균 {number(comparison.metrics.expectedResets, 1)}회</p>}
  </CalculatorCard>;
}

const decisionLabels = { sell: '판매', floor: '처분가로 판매', hold: '계속 재설정', unreachable: '도달 불가' };

function Decisions({ result, settings }) {
  const lowest = result.rows[0]?.threshold;
  return <CalculatorCard as="section" className="flame-card ft-decisions">
    <div className="flame-section-title"><h2>구간별 판매 판정</h2><span>확률은 재설정 1회 기준</span></div>
    <div className="flame-table-scroll"><table><thead><tr><th>추가옵션 구간</th><th>판매가</th><th>판정</th><th>구간 확률</th><th>이상 확률</th><th>판매 비중</th></tr></thead>
      <tbody>{[...result.rows].reverse().map(row => <tr key={row.id}>
        <td>{grade(row.threshold)} 이상{row.upper !== null && <small> ~ {grade(row.upper)} 미만</small>}</td>
        <td>{meso(row.price)}</td>
        <td><span className={`ft-badge ft-${row.decision}`}>{decisionLabels[row.decision]}</span></td>
        <td>{probability(row.probability)}</td>
        <td>{probability(row.atLeastProbability)}</td>
        <td>{row.decision === 'sell' || row.decision === 'floor' ? probability(row.saleShare) : '—'}</td>
      </tr>)}
      <tr><td>{grade(lowest)} 미만</td><td>{result.unpricedDecision === 'floor' ? meso(settings.floorPrice) : '—'}</td>
        <td><span className={`ft-badge ft-${result.unpricedDecision}`}>{decisionLabels[result.unpricedDecision]}</span></td>
        <td>{probability(result.unpricedProbability)}</td><td>100%</td>
        <td>{result.unpricedDecision === 'floor' ? probability(result.sales.find(sale => sale.id === FLAME_TRADE_FLOOR_ID)?.share ?? 0) : '—'}</td></tr>
      </tbody></table></div>
    <p className="flame-small-note">결과는 도달한 가장 높은 기준의 가격으로 판매합니다. 이상 확률은 해당 급수 이상이 나올 확률이고, 판매 비중은 판매한 매물 중 그 구간의 비율입니다. 이 레벨·주스탯에서 가능한 최고 환산값은 {grade(result.model.maxScore)}입니다.</p>
  </CalculatorCard>;
}

function Risk({ result, resetCost }) {
  const { risk } = result;
  return <CalculatorCard as="section" className="flame-card ft-risk">
    <div className="flame-section-title"><h2>운에 따른 차이</h2><span>매물 1개 · 정확 계산</span></div>
    <div className="ft-risk-grid">
      <div><h3>매물 순익 분포</h3>
        {[['하위 10% (불운)', risk.profit.p10], ['중앙값', risk.profit.p50], ['상위 10% (행운)', risk.profit.p90]].map(([label, value]) =>
          <p key={label}><span>{label}</span><b className={tone(value)}>{signed(value)}</b></p>)}
        <p><span>손실이 날 확률</span><b>{probability(risk.lossProbability)}</b></p></div>
      <div><h3>판매까지 재설정 횟수</h3>
        {[['절반은', risk.resets.p50], ['90%는', risk.resets.p90], ['99%는', risk.resets.p99]].map(([label, value]) =>
          <p key={label}><span>{label} {number(value, 0)}회 이내</span><b>{meso(value * resetCost)}</b></p>)}</div>
    </div>
    <p className="flame-small-note">기댓값이 +여도 매물마다 편차가 큽니다. 재설정 자금은 90~99% 구간을 기준으로 준비하세요.</p>
  </CalculatorCard>;
}

function Examples({ examples }) {
  if (!examples.length) return null;
  return <CalculatorCard as="section" className="flame-card">
    <div className="flame-section-title"><h2>이런 추가옵션부터 판매하세요</h2><span>판매 기준을 갓 넘긴 예시</span></div>
    <div className="flame-table-scroll"><table><thead><tr><th>기준 주스탯</th><th>주스탯</th><th>부스탯</th><th>공격력·마력</th><th>올스탯</th><th>환산 급수</th></tr></thead>
      <tbody>{examples.map((example, index) => <tr key={index}>
        <td>{example.stat}</td><td>{number(example.values.main)}</td>
        <td>{example.subStat} {number(example.values.sub)}</td>
        <td>{example.attackType === 'magic' ? '마력' : '공격력'} {number(example.values.attack)}</td>
        <td>{number(example.values.all)}%</td><td><b>{grade(example.score)}</b></td>
      </tr>)}</tbody></table></div>
    <p className="flame-small-note">네 줄을 합산한 결과입니다. 표에 없는 조합도 환산 급수가 판매 기준 이상이면 판매합니다.</p>
  </CalculatorCard>;
}

export default function FlameTradePage() {
  const [settings, setSettings] = useState(() => normalizeFlameTradeSettings(readJSON(SAVE_KEY, null)));
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [presetSel, setPresetSel] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [recalculate, setRecalculate] = useState(0);
  const worker = useRef(null);
  const request = useRef(0);
  const priced = settings.prices.some(row => row.price !== '');

  useEffect(() => writeJSON(SAVE_KEY, settings), [settings]);
  useEffect(() => writeJSON(PRESET_KEY, presets), [presets]);

  // Prices recalculate automatically; the newest request alone may update the page.
  useEffect(() => {
    const id = ++request.current;
    worker.current?.terminate();
    worker.current = null;
    setResult(null);
    setError('');
    setBusy(false);
    if (!priced) {
      setProgress('판매가를 입력하면 자동으로 계산합니다.');
      return undefined;
    }
    try { validateFlameTradeSettings(settings); }
    catch (failure) {
      setError(failure.message);
      setProgress('');
      return undefined;
    }
    setBusy(true);
    setProgress('입력한 판매 조건을 준비하고 있습니다…');
    const timer = setTimeout(() => {
      try {
        const source = document.getElementById('flame-trade-worker-source');
        if (!source) throw new Error('계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
        const url = URL.createObjectURL(new Blob([JSON.parse(source.textContent)], { type: 'text/javascript' }));
        let engine;
        try { engine = new Worker(url); } finally { URL.revokeObjectURL(url); }
        worker.current = engine;
        engine.onmessage = ({ data }) => {
          if (request.current !== id || data.id !== id) return;
          if (data.type === 'progress') setProgress(data.message);
          if (data.type === 'result' || data.type === 'error') {
            if (data.type === 'result') setResult(data.result);
            else setError(data.message || '계산하지 못했습니다. 입력값을 확인해 주세요.');
            setProgress(data.type === 'result' ? '계산 완료' : '');
            setBusy(false);
            engine.terminate();
            worker.current = null;
          }
        };
        engine.onerror = () => {
          if (request.current !== id) return;
          setError('계산 엔진을 실행하지 못했습니다. 다시 계산해 주세요.');
          setBusy(false);
          setProgress('');
          engine.terminate();
          worker.current = null;
        };
        engine.postMessage({ id, settings });
      } catch (failure) {
        if (request.current !== id) return;
        setError(failure.message);
        setBusy(false);
        setProgress('');
      }
    }, 200);
    return () => { clearTimeout(timer); request.current += 1; worker.current?.terminate(); worker.current = null; };
  }, [settings, recalculate]);

  const change = patch => setSettings(previous => ({ ...previous, ...patch }));
  const updateRow = (id, patch) => setSettings(previous => ({ ...previous, prices: previous.prices.map(row => row.id === id ? { ...row, ...patch } : row) }));
  const addRow = () => setSettings(previous => ({ ...previous, prices: [...previous.prices, newFlameTradeRow(rowId())] }));
  const removeRow = id => setSettings(previous => ({ ...previous, prices: previous.prices.filter(row => row.id !== id) }));
  const sortRows = () => setSettings(previous => ({
    ...previous,
    prices: previous.prices.map((row, index) => ({ row, index, value: rowGrade(row, previous.weights) }))
      .sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity) || a.index - b.index).map(({ row }) => row),
  }));
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setPresets(previous => ({ ...previous, [name]: copy(settings) }));
    setPresetName('');
    setPresetSel(name);
  };
  const deletePreset = () => {
    if (!presetSel) return;
    setPresets(previous => { const next = { ...previous }; delete next[presetSel]; return next; });
    setPresetSel('');
  };

  return <main className="flame-page ft-page calculator-page">
    <CalculatorHeader className="flame-header" eyebrow="BONUS STAT TRADE" scope="보스 방어구 · 장신구"
      title={<>추가옵션 <em>장사 계산기</em></>}
      description={<>노작 매입가와 추가옵션 시세로 메소 재설정 장사의 기대 수익을 계산합니다.<br />몇 급부터 팔아야 재설정 1회당 이득이 가장 큰지 확인하세요.</>} />
    <div className="flame-layout calculator-layout ft-layout">
      <section className="flame-settings calculator-settings" aria-label="추가옵션 장사 설정">
        <TradeEquipmentSettings values={{ itemPrice: settings.itemPrice, level: settings.level, fee: settings.fee, floorPrice: settings.floorPrice }}
          onChange={change}
          levelOptions={FLAME_TRADE_LEVELS.map(value => ({ value, label: `${value}제` }))}
          labels={{ level: '아이템 레벨 제한', floorPrice: '잡추옵 처분가 (억 메소)' }}
          purchaseHelp="추가옵션을 재설정하기 전 매물 한 개의 매입가입니다."
          floorLabel="잡추옵 처분가 (억 메소)"
          floorHelp="판매 조건에 못 미친 매물을 넘길 수 있는 가격입니다. 자동 최적화에서만 비교하며 0이면 처분하지 않습니다.">
          <MainStatSelector selected={settings.mainStats} onChange={mainStats => change({ mainStats })} />
        </TradeEquipmentSettings>
        <CalculatorCard as="div" className="calculator-trade-toggles">
          <ToggleField on={settings.autoSell} onChange={autoSell => change({ autoSell })} label="판매·재설정 자동 최적화"
            description="켜면 재설정 1회당 기대 이득이 가장 큰 판매 기준을 찾습니다. 끄면 판매가를 입력한 조건에 도달하는 즉시 판매합니다." />
        </CalculatorCard>
        <WeightSettings weights={settings.weights} onChange={weights => change({ weights })} />
        <CalculatorCard as="div" className="flame-card ft-presets"><div className="flame-section-title"><h2>입력 프리셋</h2><span>현재 설정 저장</span></div>
          <PresetControls names={Object.keys(presets)} presetName={presetName} setPresetName={setPresetName}
            selectedName={presetSel} onSelect={name => { setPresetSel(name); if (name) setSettings(normalizeFlameTradeSettings(presets[name])); }}
            onSave={savePreset} onDelete={deletePreset} />
        </CalculatorCard>
        <TradeResetCostSettings title="추가옵션 재설정 비용" costs={[{ key: 'meso', label: '메소 재설정 1회', color: 'var(--ui-accent)',
          value: settings.resetCost, ariaLabel: '추가옵션 재설정 1회 비용 (메소)', onChange: resetCost => change({ resetCost }) }]}
          note="기본값: 2026.03.19 업데이트 기준 300만 메소 (레벨 무관). 할인·이벤트 비용은 직접 수정할 수 있습니다." />
      </section>
      <section className="flame-results calculator-results" aria-label="추가옵션 장사 판매가와 계산 결과" aria-busy={busy}>
        <TradePriceEditor description="알고 있는 추가옵션 시세를 수치와 판매가의 쌍으로 입력하세요. 수치는 환산 급수 합계로 입력하거나 주스탯·부스탯·공격력/마력·올스탯으로 나눠 입력할 수 있습니다."
          actions={<button type="button" className="trade-price-action" disabled={settings.prices.length < 2} onClick={sortRows}>급수 순으로 정렬</button>}
          persistenceNote="판매가와 환산표는 이 브라우저에 자동 저장됩니다.">
          <section className="trade-price-section">
            <h3>추가옵션 수치별 판매가</h3>
            <div className="ft-price-list">
              {!settings.prices.length && <p className="ft-empty-rows">판매가 조건이 없습니다. 조건을 추가해 추가옵션 수치와 시세를 입력하세요.</p>}
              {settings.prices.map((row, index) => <PriceRow key={row.id} row={row} index={index} weights={settings.weights}
                onChange={patch => updateRow(row.id, patch)} onRemove={() => removeRow(row.id)} />)}
              <button type="button" className="trade-price-add-row" onClick={addRow}>＋ 판매가 조건 추가</button>
            </div>
            <p className="trade-price-help">각 결과는 도달한 가장 높은 기준의 가격으로 판매합니다. 예: 140급 2억, 160급 5억을 입력하면 150급은 2억, 170급은 5억입니다. 스탯별로 입력한 조건은 왼쪽 환산표로 급수를 계산하며, 판매가를 비운 조건은 계산에서 제외합니다.</p>
          </section>
        </TradePriceEditor>
        <CalculateButton disabled={!priced} onClick={() => setRecalculate(value => value + 1)}>장사 기대 수익 계산<span aria-hidden="true">→</span></CalculateButton>
        <p className="flame-status calculator-status" role="status" aria-live="polite">{progress}</p>
        {error && <p className="flame-error" role="alert">{error}</p>}
        {!result && !error && <CalculatorCard as="div" className="flame-card flame-empty">
          <div className="flame-empty-icon" aria-hidden="true">✦</div>
          <h2>{busy ? '추가옵션 확률과 판매 기준을 계산하고 있습니다' : '판매가를 1개 이상 입력하면 계산이 시작됩니다'}</h2>
          <p>재설정 결과마다 판매할지 계속 재설정할지 정하고<br />매물 하나의 기대 순익과 재설정 1회당 이득을 계산합니다.</p>
          {busy && <div className="flame-progress" />}
          <div className="flame-empty-steps"><span>추가옵션 시세</span><i>＋</i><span>옵션 확률</span><i>−</i><span>매입가 · 재설정 비용</span></div>
        </CalculatorCard>}
        {result && !result.possible && <CalculatorCard as="div" className="flame-card ft-impossible" role="status">
          <strong>현재 입력으로는 매물을 판매할 수 없습니다.</strong><p>{result.reason} 판매 조건의 수치를 낮추거나 판매 대상 주스탯·레벨을 확인해 주세요.</p>
        </CalculatorCard>}
        {result?.possible && <>
          <Recommendation result={result} mainStats={result.model.mainStats} />
          <Summary result={result} />
          <Decisions result={result} settings={settings} />
          <Risk result={result} resetCost={result.model.resetCost} />
          <Examples examples={result.examples} />
        </>}
        {result?.warnings?.length > 0 && <CalculatorCard as="details" className="flame-card flame-assumptions" open>
          <summary>계산 범위와 주의사항</summary><ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </CalculatorCard>}
        <CalculatorCard as="details" className="flame-card flame-assumptions">
          <summary>계산 기준과 공식 확률 출처</summary>
          <ul>
            <li>보스 방어구·장신구의 메소 추가옵션 재설정을 기준으로 합니다. 옵션 종류·등급 확률과 레벨별 수치는 추가옵션 효율 계산기와 같은 공식 확률표를 사용합니다.</li>
            <li>재설정할 때마다 기존·신규 옵션 중 좋은 쪽을 유지할 수 있으므로, 판매 기준 이상이 처음 나올 때까지 재설정한다고 봅니다.</li>
            <li>선택한 주스탯마다 고정 부스탯(STR→DEX, DEX→STR, INT→LUK, LUK→DEX)과 공격력(INT는 마력)을 환산표로 합산하고, 가장 높은 값을 그 매물의 환산 급수로 봅니다.</li>
            <li>자동 최적화는 매입·재설정·판매를 반복할 때 재설정 1회당 기대 이득이 가장 큰 판매 기준을 찾습니다. 이득이 나는 기준이 없으면 매물당 기대 손실이 가장 작은 기준을 사용합니다.</li>
            <li>직전과 완전히 같은 결과를 제외하는 게임 규칙, 착용 레벨 감소·HP 등 다른 옵션의 가치, 무기와 제논·데몬어벤져 전용 가치는 계산하지 않습니다. 기댓값은 평균이며 수익을 보장하지 않습니다.</li>
          </ul>
          <div className="flame-source-links">{FLAME_SOURCES.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
        </CalculatorCard>
      </section>
    </div>
    <CalculatorFooter className="flame-footer">메이플 계산기 · 입력값과 프리셋은 이 브라우저에 자동 저장됩니다.</CalculatorFooter>
  </main>;
}