import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_ADDITIONAL_TRADE_SETTINGS,
  validateAdditionalTradeSettings,
} from './additional-trade-calculator.mjs';
import { resetAdditionalCosts } from './additional-calculator.mjs';
import { ADDITIONAL_GRADES, ADDITIONAL_SLOTS, ADDITIONAL_LEVELS } from './additional-data.mjs';
import './flame.css';
import './additional-trade.css';

const SAVE_KEY = 'maple:additional-trade:settings:v1';
const PRESET_KEY = 'maple:additional-trade:presets:v1';
const copy = value => JSON.parse(JSON.stringify(value));
const stats = ['STR', 'DEX', 'INT', 'LUK'];
const critTotals = [0, 1, 2, 3, 4, 5, 6, 7, 9];
const efficiencyFields = [
  { key: 'mainFlat', label: '주스탯 +10', scale: 10 },
  { key: 'subFlat', label: '부스탯 +10', scale: 10 },
  { key: 'attackFlat', label: '유효 공격력·마력 +10', scale: 10 },
  { key: 'subPercent', label: '부스탯 +1%', scale: 1 },
  { key: 'allPercent', label: '올스탯 +1%', scale: 1 },
  { key: 'criticalDamagePercent', label: '크리티컬 데미지 +1%', scale: 1 },
  { key: 'criticalRatePercent', label: '크리티컬 확률 +1%', scale: 1 },
];
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
const percent = value => `${number(value, 3)}%`;
const probabilityPercent = value => {
  if (value === 0) return '0%';
  const pct = value * 100;
  return `${pct < 0.001 ? pct.toExponential(2) : number(pct, pct < 0.1 ? 4 : 2)}%`;
};
const reachability = value => value === 0 ? '도달 불가' : probabilityPercent(value);
const meso = value => {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e8) return `${number(value / 1e8)}억 메소`;
  if (Math.abs(value) >= 1e4) return `${number(value / 1e4)}만 메소`;
  return `${number(value, 0)} 메소`;
};
const readJSON = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const cleanPriceRows = rows => Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)).map((row, index) => ({
  id: typeof row.id === 'string' && row.id ? row.id : `restored-${index}-${Math.random().toString(36).slice(2, 7)}`,
  stat: stats.includes(row.stat) ? row.stat : 'STR',
  min: typeof row.min === 'number' && Number.isFinite(row.min) && row.min >= 0 ? row.min : 0,
  cd: Number.isInteger(row.cd) && row.cd >= 0 && row.cd <= 3 ? row.cd : 0,
  crit: critTotals.includes(row.crit) ? row.crit : 0,
  price: row.price === '' || (typeof row.price === 'number' && Number.isFinite(row.price) && row.price >= 0) ? row.price : '',
})) : [];
function normalizeSettings(saved) {
  const defaults = copy(DEFAULT_ADDITIONAL_TRADE_SETTINGS);
  saved = record(saved);
  const storedPrices = record(saved.prices);
  const prices = Object.fromEntries(['shared', ...ADDITIONAL_GRADES].map(key => [key, cleanPriceRows(storedPrices[key])]));
  const storedBanks = record(saved.priceBanks);
  const priceBanks = Object.fromEntries(Object.entries(storedBanks)
    .filter(([, bank]) => bank && typeof bank === 'object' && !Array.isArray(bank))
    .map(([key, bank]) => [key, Object.fromEntries(['shared', ...ADDITIONAL_GRADES].map(grade => [grade, cleanPriceRows(bank[grade])]))]));
  return {
    ...defaults, ...saved,
    efficiency: { ...defaults.efficiency, ...record(saved.efficiency) },
    costs: { ...defaults.costs, ...record(saved.costs) },
    upRates: { ...defaults.upRates, ...record(saved.upRates) }, pity: { ...defaults.pity, ...record(saved.pity) },
    stacks: { ...defaults.stacks, ...record(saved.stacks) }, prices, priceBanks,
  };
}
function loadSettings() { return normalizeSettings(readJSON(SAVE_KEY, null)); }
function loadPresets() {
  return Object.fromEntries(Object.entries(record(readJSON(PRESET_KEY, {})))
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)));
}
const emptyPriceLists = () => ({ shared: [], 에픽: [], 유니크: [], 레전드리: [] });
const priceBankKey = (slot, separateCrit) => `${slot}|${separateCrit ? 'split' : 'converted'}`;

function Numeric({ label, value, onChange, unit, scale = 1, min = 0, max, step = 'any', ...props }) {
  return <span className="at-number"><input aria-label={label} type="number" min={min} max={max} step={step} inputMode="decimal"
    value={value === '' || value == null ? '' : Number((value * scale).toPrecision(12))}
    onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value) / scale)} {...props} />{unit && <small>{unit}</small>}</span>;
}

function PriceRows({ rows, grade, settings, onChange, onAdd, onRemove }) {
  return <div className="at-price-list">
    {!rows.length && <p className="at-empty-rows">가격 조건이 없습니다. 목표 스탯과 최소 환산값을 추가해 시세를 입력하세요.</p>}
    {rows.map((row, index) => <div className={`at-price-row ${settings.slot !== '모자' && !(settings.slot === '장갑' && settings.separateCrit) ? 'at-plain-price-row' : ''}`} key={row.id}>
      <label><span className="at-visually-hidden">{grade || '공통'} {index + 1}번 조건의 주스탯</span><select aria-label={`${grade || '공통'} ${index + 1}번 가격 조건의 주스탯`} value={row.stat} onChange={event => onChange(row.id, { stat: event.target.value })}>{stats.map(stat => <option key={stat}>{stat}</option>)}</select></label>
      <label className="at-min-wrap"><span>최소 스탯 환산</span><Numeric label={`${grade || '공통'} ${index + 1}번 가격 조건의 최소 스탯 환산 (%)`} value={row.min} unit="%급 이상" onChange={value => onChange(row.id, { min: value })} /></label>
      {settings.slot === '모자' && <label><span>쿨감 합계</span><select aria-label={`${grade || '공통'} ${index + 1}번 조건의 쿨감 합계 이상`} value={row.cd ?? 0} onChange={event => onChange(row.id, { cd: Number(event.target.value) })}>{[0, 1, 2, 3].map(n => <option value={n} key={n}>{n === 0 ? '제한 없음' : `${n}초 이상`}</option>)}</select></label>}
      {settings.slot === '장갑' && settings.separateCrit && <label><span>크뎀 합계</span><select aria-label={`${grade || '공통'} ${index + 1}번 조건의 크리티컬 데미지 합계 이상`} value={row.crit ?? 0} onChange={event => onChange(row.id, { crit: Number(event.target.value) })}>{critTotals.map(n => <option value={n} key={n}>{n === 0 ? '제한 없음' : `${n}% 이상`}</option>)}</select></label>}
      <label className="at-price-input"><span>시세</span><Numeric label={`${grade || '공통'} ${index + 1}번 가격 조건의 시세 (억 메소)`} value={row.price} scale={1e-8} unit="억 메소" onChange={value => onChange(row.id, { price: value })} /></label>
      <button className="at-remove" type="button" aria-label={`${grade || '공통'} ${index + 1}번 가격 조건 삭제`} onClick={() => onRemove(row.id)}>삭제</button>
    </div>)}
    <button type="button" className="at-add-row" onClick={onAdd}>＋ 가격 조건 추가</button>
  </div>;
}

function ResultSummary({ result, settings }) {
  if (!result?.possible && !result?.fallback) return <div className="at-impossible" role="status"><strong>현재 입력으로는 기대 수익을 계산할 수 없습니다.</strong><p>{result?.reason || '판매 조건과 시세를 확인해 주세요.'}</p></div>;
  const analysis = result.possible ? result : result.fallback;
  const current = analysis?.current || analysis;
  const steady = analysis?.steadyState || analysis?.steady;
  const rows = result?.priceRows || [];
  return <>
    {!result.possible && <div className="at-impossible" role="status"><strong>자동 최적화로는 판매하지 않는 결과입니다.</strong><p>{result.reason} 아래에는 {analysis.label || '가격 조건 매칭 결과를 모두 판매하는 경우'}의 참고 지표를 표시합니다.</p></div>}
    <div className="at-result-hero"><span>현재 입력한 조건의 매물당 기대 순이익</span><strong className={(current?.expectedProfit ?? 0) >= 0 ? 'at-positive' : 'at-negative'}>{meso(current?.expectedProfit)}</strong>
      <p>매입가·재설정 비용·판매 수수료를 반영한 기대값입니다.</p></div>
          <div className="at-metric-grid">
      <div><span>기대 판매가 · 현재 매물당</span><b>{meso(current?.expectedRevenue)}</b></div>
      <div><span>수수료 차감 후 판매대금 · 현재 매물당</span><b>{meso(current?.expectedNetRevenue)}</b></div>
      <div><span>재설정 기대 비용 · 현재 매물당</span><b>{meso(current?.expectedCost)}</b></div>
      <div><span>기대 재설정 횟수 · 현재 매물당</span><b>{number(current?.expectedAttempts)}회</b></div>
      <div><span>매입가 포함 순이익 · 현재 매물당</span><b>{meso(current?.expectedProfit)}</b></div>
      <div><span>매입가 포함 순이익 · 장기 매물당</span><b>{meso(steady?.expectedProfit)}</b></div>
      <div><span>순이익 · 장기 재설정 1회당</span><b>{meso(steady?.profitPerReset)}</b></div>
    </div>
    {current?.attemptsByGrade && <div className="at-grade-table"><h3>등급별 기대 재설정 횟수</h3><div>{ADDITIONAL_GRADES.map(grade => <span key={grade}>{grade}<b>{number(current.attemptsByGrade[grade] || 0)}회</b></span>)}</div></div>}
    {current?.finalGrades && <div className="at-grade-table"><h3>판매 시점 등급 비중</h3><div>{ADDITIONAL_GRADES.map(grade => <span key={grade}>{grade}<b>{probabilityPercent(current.finalGrades[grade] || 0)}</b></span>)}</div></div>}
    {!!rows.length && <div className="at-output-table"><h3>가격 조건별 판매 판정</h3><div className="flame-table-scroll"><table><thead><tr><th>등급</th><th>판매 조건</th><th>가격</th><th>등급별 등장 확률</th><th>가격 적용 확률</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.grade}-${row.id}-${i}`}><td>{row.grade}</td><td>{row.label}</td><td>{row.price == null ? '시세 입력 필요' : meso(row.price)}</td><td>{row.price == null ? '—' : reachability(row.probability || 0)}</td><td>{row.price == null ? '—' : probabilityPercent(row.winningProbability || 0)}</td></tr>)}</tbody></table></div></div>}
    <TradeDecisions decisions={analysis?.decisions || []} priceRows={rows} summaries={analysis?.actionSummaries || []} settings={settings} />
    <p className="at-note">{settings.autoSell ? '자동 최적화에서는 레전드리 잡옵 처분가를 등록 시세와 비교해 적용합니다.' : '자동 최적화를 끄면 레전드리 가격 조건이 하나도 없을 때 잡옵 처분가를 적용합니다.'}</p>
  </>;
}

function TradeDecisions({ decisions, priceRows, summaries = [], settings }) {
  const [grade, setGrade] = useState(settings.startGrade);
  const [epicStack, setEpicStack] = useState(settings.stacks?.에픽 || 0);
  const [uniqueStack, setUniqueStack] = useState(settings.stacks?.유니크 || 0);
  const eligibleGrades = ADDITIONAL_GRADES.slice(ADDITIONAL_GRADES.indexOf(settings.startGrade));
  const activeEpicStack = grade === '에픽' ? epicStack : 0;
  const activeUniqueStack = grade === '레전드리' ? 0 : uniqueStack;
  const currentRows = decisions.filter(row => row.sourceGrade === grade
    && row.sourceStacks?.에픽 === activeEpicStack && row.sourceStacks?.유니크 === activeUniqueStack);
  const selectedSummary = summaries.find(row => row.grade === grade
    && row.stacks?.에픽 === activeEpicStack && row.stacks?.유니크 === activeUniqueStack);
  const groups = new Map();
  for (const row of currentRows) {
    const key = `${row.action}|${row.resultGrade}|${row.targetId || ''}|${row.price ?? ''}`;
    const group = groups.get(key) || { action: row.action, grade: row.resultGrade, targetId: row.targetId, price: row.price, probability: 0 };
    group.probability += row.probability || 0; groups.set(key, group);
  }
  const outcomes = [...groups.values()].sort((a, b) => (b.probability - a.probability));
  return <div className="at-grade-table at-decisions"><h3>현재·선택한 천장 스택의 행동</h3>
    <div className="at-decision-selectors"><label>등급<select aria-label="행동을 확인할 등급" value={grade} onChange={event => { const nextGrade = event.target.value; setGrade(nextGrade); if (nextGrade !== '에픽') setEpicStack(0); if (nextGrade === '레전드리') setUniqueStack(0); }}>{eligibleGrades.map(value => <option key={value}>{value}</option>)}</select></label>
      {settings.startGrade === '에픽' && grade === '에픽' && <label>에픽 스택<Numeric label="행동을 확인할 에픽 스택" value={epicStack} step="1" max={settings.pity.에픽} unit="회" onChange={setEpicStack} /></label>}
      {settings.startGrade !== '레전드리' && grade !== '레전드리' && <label>유니크 스택<Numeric label="행동을 확인할 유니크 스택" value={uniqueStack} step="1" max={settings.pity.유니크} unit="회" onChange={setUniqueStack} /></label>}
    </div>
    {!!outcomes.length ? <div className="flame-table-scroll"><table><thead><tr><th>결과 등급</th><th>행동</th><th>판매 조건</th><th>가격</th><th>결과 확률</th></tr></thead><tbody>{outcomes.map((row, index) => <tr key={index}><td>{row.grade}</td><td>{row.action === 'sell' ? '판매' : '계속 재설정'}</td><td>{priceRows.find(item => item.id === row.targetId && item.grade.startsWith(row.grade))?.label || (row.action === 'sell' ? '레전드리 잡옵 처분가' : '가격 조건 미달')}</td><td>{row.price == null ? '—' : meso(row.price)}</td><td>{probabilityPercent(row.probability)}</td></tr>)}</tbody></table></div>
    : selectedSummary ? <><div className="at-grade-table"><div><span>판매 선택 확률<b>{probabilityPercent(selectedSummary.sellProbability)}</b></span><span>계속 재설정 선택 확률<b>{probabilityPercent(selectedSummary.holdProbability)}</b></span></div></div><details className="at-stack-details"><summary>결과 등급별 가격 문턱</summary><div className="flame-table-scroll"><table><thead><tr><th>결과 등급</th><th>자동 판매 가격 문턱</th><th>해당 결과 확률</th></tr></thead><tbody>{selectedSummary.priceCutoffs?.map((row, index) => <tr key={`${row.resultGrade}-${index}`}><td>{row.resultGrade}</td><td>{row.comparison === 'always' ? '등록된 가격이면 판매' : row.comparison === 'never' ? '계속 재설정' : row.sellPriceCutoff == null ? '가격 조건에 따라 결정' : `${row.comparison === '>' ? '초과' : '이상'} ${meso(row.sellPriceCutoff)}`}</td><td>{reachability(row.probabilityMass)}</td></tr>)}</tbody></table></div></details></>
      : <p className="at-note">선택한 등급·천장 스택의 요약이 없습니다.</p>}
  </div>;
}

export default function AdditionalTradePage() {
  const [settings, setSettings] = useState(loadSettings);
  const [priceGrade, setPriceGrade] = useState(() => loadSettings().startGrade);
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [presetSel, setPresetSel] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const worker = useRef(null);
  const request = useRef(0);
  const settingsRef = useRef(settings); settingsRef.current = settings;

  useEffect(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(settings)); } catch {} }, [settings]);
  useEffect(() => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); } catch {} }, [presets]);
  function change(patch) {
    request.current += 1; worker.current?.terminate(); worker.current = null;
    setSettings(prev => ({ ...prev, ...patch })); setResult(null); setBusy(false); setError('');
    setProgress('입력값이 바뀌었습니다. 다시 계산해 주세요.');
  }
  function changePriceScope(patch) {
    const banks = { ...(settings.priceBanks || {}), [priceBankKey(settings.slot, settings.separateCrit)]: settings.prices };
    const slot = patch.slot ?? settings.slot;
    const separateCrit = patch.separateCrit ?? settings.separateCrit;
    const key = priceBankKey(slot, separateCrit);
    const nextPrices = banks[key] || emptyPriceLists();
    change({ ...patch, prices: nextPrices, priceBanks: banks });
  }
  function changeNested(key, name, value) { change({ [key]: { ...settings[key], [name]: value } }); }
  function listFor(grade) { return settings.prices[settings.separateGrades ? grade : 'shared'] || []; }
  function updateRow(grade, id, patch) { const key = settings.separateGrades ? grade : 'shared'; change({ prices: { ...settings.prices, [key]: settings.prices[key].map(row => row.id === id ? { ...row, ...patch } : row) } }); }
  function addRow(grade) { const key = settings.separateGrades ? grade : 'shared'; const rows = settings.prices[key] || []; change({ prices: { ...settings.prices, [key]: [...rows, { id: `price-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, stat: 'STR', min: 0, cd: 0, crit: 0, price: '' }] } }); }
  function removeRow(grade, id) { const key = settings.separateGrades ? grade : 'shared'; change({ prices: { ...settings.prices, [key]: settings.prices[key].filter(row => row.id !== id) } }); }
  function calculate() {
    try {
      const snapshot = settingsRef.current; validateAdditionalTradeSettings(snapshot);
      worker.current?.terminate();
      const source = document.getElementById('additional-trade-worker-source');
      if (!source) throw new Error('계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      const url = URL.createObjectURL(new Blob([JSON.parse(source.textContent)], { type: 'text/javascript' }));
      let engine; try { engine = new Worker(url); } finally { URL.revokeObjectURL(url); }
      worker.current = engine; const id = ++request.current;
      setBusy(true); setResult(null); setError(''); setProgress('등급별 옵션 확률과 판매 조건을 계산하고 있습니다…');
      engine.onmessage = ({ data }) => {
        if (data.id !== request.current) return;
        if (data.type === 'progress') setProgress(data.message);
        if (data.type === 'result') { setResult(data.result); setBusy(false); setProgress('계산 완료'); engine.terminate(); worker.current = null; }
        if (data.type === 'error') { setError(data.message || '계산하지 못했습니다. 입력값을 확인해 주세요.'); setBusy(false); setProgress(''); engine.terminate(); worker.current = null; }
      };
      engine.onerror = () => { if (id !== request.current) return; setError('계산 엔진을 실행하지 못했습니다. 다시 계산해 주세요.'); setBusy(false); setProgress(''); engine.terminate(); worker.current = null; };
      engine.postMessage({ id, settings: snapshot });
    } catch (failure) { setError(failure.message); setBusy(false); setProgress(''); }
  }
  useEffect(() => () => { request.current += 1; worker.current?.terminate(); }, []);
  const addNewPreset = () => { const name = presetName.trim(); if (!name) return; setPresets(prev => ({ ...prev, [name]: copy(settings) })); setPresetName(''); setPresetSel(name); };
  const deletePreset = () => { if (!presetSel) return; setPresets(prev => { const next = { ...prev }; delete next[presetSel]; return next; }); setPresetSel(''); };
  const gradeCards = settings.separateGrades ? [priceGrade] : [null];

  return <main className="flame-page at-page">
    <header className="flame-header"><div><div className="flame-eyebrow">ADDITIONAL TRADE <span>방어구 · 장신구</span></div><h1>에디셔널 <em>잠재능력 장사</em></h1><p>에디셔널 잠재능력 재설정의 기대 수익을 계산합니다.<br />목표 성능별 시세와 등급업 확률을 입력해 매물당 순이익을 확인하세요.</p></div><div className="additional-cube-mark" aria-hidden="true"><span>◇</span><i /></div></header>
    <div className="flame-layout at-layout">
      <section className="flame-settings" aria-label="에디셔널 잠재능력 장사 계산 설정">
        <div className="flame-card"><div className="flame-section-title"><h2>매물과 재설정 비용</h2><span className="flame-pill">기본 입력</span></div>
          <div className="additional-field-grid">
            <label className="additional-field">장비 부위<select value={settings.slot} aria-label="대상 아이템 부위" onChange={event => changePriceScope({ slot: event.target.value })}>{ADDITIONAL_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</select></label>
            <label className="additional-field">아이템 레벨<select aria-label="아이템 레벨 제한" value={settings.level} onChange={event => { const level = Number(event.target.value); change({ level, costs: resetAdditionalCosts(level) }); }}>{ADDITIONAL_LEVELS.map(level => <option value={level} key={level}>{level}레벨</option>)}</select></label>
            <label className="additional-field">시작 등급<select value={settings.startGrade} aria-label="재설정 시작 등급" onChange={event => change({ startGrade: event.target.value })}>{ADDITIONAL_GRADES.map(grade => <option key={grade}>{grade}</option>)}</select></label>
            <label className="additional-field">기준 캐릭터 레벨<Numeric label="기준 캐릭터 레벨" value={settings.characterLevel} min={1} max={300} step="1" unit="레벨" onChange={value => change({ characterLevel: value })} /></label>
          </div>
          <div className="at-cost-fields">
            <label className="flame-field-label">시작 등급 깡통 매입가<Numeric label="시작 등급 깡통 매입가 (억 메소)" value={settings.itemPrice} scale={1e-8} unit="억 메소" onChange={value => change({ itemPrice: value })} /></label>
            <label className="flame-field-label">경매장 수수료<Numeric label="경매장 수수료 (%)" value={settings.fee} unit="%" max={100} onChange={value => change({ fee: value })} /></label>
            <label className="flame-field-label">레전드리 잡옵 처분가<Numeric label="레전드리 잡옵 처분가 (억 메소)" value={settings.floorPrice} scale={1e-8} unit="억 메소" onChange={value => change({ floorPrice: value })} /></label>
          </div>
          <p className="flame-small-note">에디셔널 {settings.startGrade} 등급에서 목표 옵션이 없는 아이템의 매입가를 입력하세요.</p>
          <label className="additional-check"><input type="checkbox" checked={settings.miracle} onChange={event => change({ miracle: event.target.checked })} /><span>미라클 타임<span>설정한 등급업 기본 확률의 2배 적용</span></span></label>
          <label className="additional-check"><input type="checkbox" checked={settings.autoSell} onChange={event => change({ autoSell: event.target.checked })} /><span>판매·재설정 자동 최적화<span>켜면 다음 재설정 결과마다 기대 순이익이 높은 행동을 선택합니다. 끄면 가격 조건에 맞는 즉시 판매합니다.</span></span></label>
          <p className="flame-small-note">9레벨당 스탯 증가 옵션은 캐릭터 레벨 ÷ 9의 정수 부분을 적용합니다. 기본 레벨 290은 32회분입니다.</p>
        </div>

        <div className="flame-card"><div className="flame-section-title"><h2>가격 조건</h2><button type="button" className="flame-text-button" onClick={() => change({ separateGrades: !settings.separateGrades })}>{settings.separateGrades ? '등급 공통 가격으로 전환' : '등급별 가격 입력으로 전환'}</button></div>
          <p className="flame-muted">같은 스탯·특수옵션 조건에서는 도달한 가장 높은 스탯 기준 구간의 가격을 적용하고, 서로 다른 조건 사이에서는 최고가 하나를 적용합니다.</p>
          {settings.slot === '장갑' && <label className="additional-check"><input type="checkbox" checked={settings.separateCrit} onChange={event => changePriceScope({ separateCrit: event.target.checked })} /><span>크리티컬 데미지 합계로 분리해 가격 입력<span>켜면 크뎀 조건을 별도로 지정합니다. 끄면 설정한 환산 효율로 스탯%에 합산합니다.</span></span></label>}
          {settings.separateGrades && <div className="at-grade-picker"><span>가격 조건을 입력할 등급</span><div role="tablist" aria-label="가격 조건을 입력할 등급" className="at-grade-tabs">{ADDITIONAL_GRADES.map(grade => <button role="tab" aria-selected={priceGrade === grade} type="button" key={grade} onClick={() => setPriceGrade(grade)}>{grade}</button>)}</div><small>시작 등급과 무관하게 세 등급의 가격을 각각 저장할 수 있습니다. 계산에는 시작 등급 이상의 가격만 사용합니다.</small></div>}
          {gradeCards.map(grade => <section className="at-grade-prices" key={grade || 'shared'}><h3>{grade ? `${grade} 가격 조건` : '모든 등급 공통 가격 조건'}</h3><PriceRows rows={listFor(grade)} grade={grade} settings={settings} onChange={(id, patch) => updateRow(grade, id, patch)} onAdd={() => addRow(grade)} onRemove={id => removeRow(grade, id)} /></section>)}
          <p className="flame-small-note">시세 행은 기본으로 추가하지 않습니다. 가격을 알고 있는 목표 성능만 직접 등록해 주세요. 목표값은 소수점 입력이 가능합니다.</p>
        </div>

        <div className="flame-card"><div className="flame-section-title"><h2>스탯 환산 효율</h2><button type="button" className="flame-text-button" onClick={() => change({ efficiency: copy(DEFAULT_ADDITIONAL_TRADE_SETTINGS.efficiency) })}>효율 기본값</button></div>
          <div className="additional-field-grid at-fixed-stats"><div><span>주스탯별 부스탯</span><b>STR → DEX · DEX → STR · INT → LUK · LUK → DEX</b></div><div><span>유효 공격력</span><b>STR·DEX·LUK: 공격력 · INT: 마력</b></div></div>
          <div className="flame-efficiencies">{efficiencyFields.map(field => <label key={field.key}><span>{field.label} <b>환산 스탯</b></span><span className="flame-equal">=</span><Numeric label={`${field.label}의 주스탯 환산 효율 (%)`} value={settings.efficiency[field.key]} scale={field.scale} unit="%" disabled={field.key === 'criticalDamagePercent' && settings.slot === '장갑' && settings.separateCrit} onChange={next => changeNested('efficiency', field.key, next)} /></label>)}</div>
          <p className="flame-small-note">크리티컬 데미지 외 기본값은 에디셔널 전략 계산기와 같습니다. 크리티컬 데미지 +1%의 기본 환산값은 주스탯 4%입니다. 부스탯은 주스탯별로 위 표의 한 종류만 반영합니다.</p>
        </div>

        <details className="flame-card additional-rules at-rules"><summary><span>확률·재설정 규칙</span><span className="additional-rule-badge">자동 입력 · 조정 가능</span></summary>
          <p className="flame-small-note">에디셔널 메소 재설정만 계산합니다. 가격 행이 없는 성능은 판매 대상으로 보지 않습니다.</p>
          <h3>등급별 재설정 1회 비용</h3><div className="additional-rule-fields">{ADDITIONAL_GRADES.map(grade => <label key={grade}><span>{grade}</span><Numeric label={`${grade} 재설정 1회 비용`} value={settings.costs[grade]} unit="메소" onChange={value => changeNested('costs', grade, value)} /></label>)}</div>
          {['에픽', '유니크'].map(grade => <div className="additional-upgrade-rule" key={grade}><h3>{grade} → {grade === '에픽' ? '유니크' : '레전드리'}</h3>
            <label className="additional-rule-row"><span>등급업 기본 확률</span><Numeric label={`${grade} 등급업 확률 (%)`} value={settings.upRates[grade]} scale={100} max={100} unit="%" onChange={value => changeNested('upRates', grade, value)} /></label>
            <label className="additional-rule-row"><span>확정 등급업까지 실패 횟수</span><Numeric label={`${grade} 확정 등급업 실패 횟수`} value={settings.pity[grade]} step="1" unit="회" onChange={value => changeNested('pity', grade, value)} /></label>
            <label className="additional-rule-row"><span>현재 실패 스택</span><Numeric label={`${grade} 현재 등급업 실패 스택`} value={settings.stacks[grade]} step="1" unit="회" onChange={value => changeNested('stacks', grade, value)} /></label>
          </div>)}
          <p className="flame-small-note">현재 스택은 해당 등급에서 누적한 실패 횟수입니다. 등급업 후에도 해당 등급의 스택 정보를 이어 계산합니다.</p>
        </details>
        <div className="flame-card at-presets"><div className="flame-section-title"><h2>입력 프리셋</h2><span>현재 설정 저장</span></div>
          <div className="at-preset-controls"><input aria-label="저장할 프리셋 이름" value={presetName} placeholder="프리셋 이름" onChange={event => setPresetName(event.target.value)} /><button type="button" disabled={!presetName.trim()} onClick={addNewPreset}>현재 입력 저장</button></div>
          <div className="at-preset-controls"><select aria-label="저장된 프리셋" value={presetSel} onChange={event => { setPresetSel(event.target.value); if (event.target.value) change(normalizeSettings(presets[event.target.value])); }}><option value="">{Object.keys(presets).length ? '프리셋 선택 → 즉시 적용' : '저장된 프리셋 없음'}</option>{Object.keys(presets).map(name => <option key={name}>{name}</option>)}</select><button type="button" disabled={!presetSel} onClick={deletePreset}>삭제</button></div>
        </div>
        <button className="flame-calculate" type="button" onClick={calculate}>{busy ? '현재 조건으로 다시 계산' : '장사 기대 수익 계산'}<span aria-hidden="true">→</span></button>
        <p className="flame-status" role="status" aria-live="polite">{progress}</p>{error && <p className="flame-error" role="alert">{error}</p>}
      </section>
      <section className="flame-results at-results" aria-label="에디셔널 장사 계산 결과" aria-busy={busy}>
        {!result && <div className="flame-card flame-empty"><div className="flame-empty-icon" aria-hidden="true">◇</div><h2>{busy ? '등급별 판매 조건과 재설정 비용을 계산하고 있습니다' : '매물당 기대 수익을 계산하세요'}</h2><p>등록한 성능별 시세, 매입가, 수수료와 재설정 비용을 반영합니다.</p>{busy && <div className="flame-progress" />}<div className="flame-empty-steps"><span>가격 조건</span><i>＋</i><span>옵션 확률</span><i>−</i><span>재설정 비용</span></div></div>}
        {result && <><div className="flame-card"><div className="flame-section-title"><h2>계산 결과</h2><span>현재 설정 · 장기 평균</span></div><ResultSummary result={result} settings={settings} /></div>
          {(result.warnings?.length > 0 || result.limits?.length > 0) && <details className="flame-card flame-assumptions at-assumptions" open><summary>계산 범위와 주의사항</summary><ul>{[...(result.warnings || []), ...(result.limits || [])].map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
        </>}
        <details className="flame-card flame-assumptions at-assumptions"><summary>계산 방법과 가정</summary><ul><li>현재 매물은 시작 등급과 입력한 등급업 스택에서 시작합니다. 판매 후에는 같은 시작 등급으로 다음 매물을 매입합니다.</li><li>등급업은 입력한 확률과 천장을 반영합니다. 시작 등급이 유니크 또는 레전드리면 그 아래 등급은 계산하지 않습니다.</li><li>여러 가격 조건에 해당하면 가장 높은 판매가 하나를 적용합니다. 레전드리 잡옵 처분가는 자동 최적화 여부에 따라 적용 범위가 달라지며, 결과 위 안내를 따릅니다.</li><li>모자는 쿨감 합계 이상, 장갑은 선택에 따라 크리티컬 데미지 합계 이상으로 조건을 나눕니다. 드롭률·메소 획득량은 가격 가치에 포함하지 않습니다.</li><li>올스탯 환산은 일반 직업의 주스탯 기준입니다. 제논과 데몬어벤져 전용 가치는 계산하지 않습니다.</li><li>공개된 에디셔널 재설정 옵션 확률표를 기반으로 하며, 데이터 범위와 계산 가정은 위 경고에 표시합니다.</li></ul></details>
      </section>
    </div><footer className="flame-footer">메이플 계산기 · 입력값과 프리셋은 이 브라우저에 자동 저장됩니다.</footer>
  </main>;
}
