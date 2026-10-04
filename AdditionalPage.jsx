import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ADDITIONAL_SETTINGS, validateAdditionalSettings, previewAdditionalScore, resetAdditionalCosts, suggestedAdditionalAppraisalCost, paidRulesIssue } from './additional-calculator.mjs';
import { ADDITIONAL_SLOTS, ADDITIONAL_GRADES, ADDITIONAL_LEVELS, ADDITIONAL_SOURCES, getAdditionalLines } from './additional-data.mjs';
import './flame.css';
import './additional.css';

const SAVE_KEY = 'maple:additional:settings:v1';
const copy = value => JSON.parse(JSON.stringify(value));
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
const score = value => `${number(value, 4)}%`;
const probability = value => `${number(value * 100, 2)}%`;
const meso = value => {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e8) return `${number(value / 1e8)}억 메소`;
  if (magnitude >= 1e4) return `${number(value / 1e4)}만 메소`;
  return `${number(value, 0)} 메소`;
};
const stats = ['STR', 'DEX', 'INT', 'LUK'];
const efficiencies = [
  { key: 'mainFlat', label: '주스탯', amount: '10', scale: 10 },
  { key: 'subFlat', label: '부스탯', amount: '10', scale: 10 },
  { key: 'attackFlat', label: '공격력·마력', amount: '10', scale: 10 },
  { key: 'subPercent', label: '부스탯', amount: '1%', scale: 1 },
  { key: 'allPercent', label: '올스탯', amount: '1%', scale: 1 },
];
const optionalEfficiencies = [
  { key: 'criticalDamagePercent', label: '크리티컬 데미지', amount: '1%', scale: 1 },
  { key: 'criticalRatePercent', label: '크리티컬 확률', amount: '1%', scale: 1 },
  { key: 'cooldownSecond', label: '스킬 쿨타임 감소', amount: '1초', scale: 1 },
  { key: 'itemDropPercent', label: '아이템 드롭률', amount: '1%', scale: 1 },
  { key: 'mesoPercent', label: '메소 획득량', amount: '1%', scale: 1 },
];
const actionLabel = action => ({ stop: '현재 옵션 유지', keep: '현재 옵션 유지', strange: '수상한 에디셔널 큐브 사용', reset: '에디셔널 잠재능력 재설정', mixed: '현재 옵션에 따라 수단 선택' }[action] || '종료 기준 확인');
const thresholdLabel = value => value === Infinity ? '등급업까지 계속' : value === null || value === undefined ? '—' : `${score(value)} 이상`;

function loadSettings() {
  const defaults = copy(DEFAULT_ADDITIONAL_SETTINGS);
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!saved || typeof saved !== 'object') return defaults;
    const merged = { ...defaults, ...saved,
      efficiency: { ...defaults.efficiency, ...saved.efficiency },
      costs: { ...defaults.costs, ...saved.costs }, upRates: { ...defaults.upRates, ...saved.upRates },
      pity: { ...defaults.pity, ...saved.pity }, stacks: { ...defaults.stacks, ...saved.stacks },
      manual: { ...defaults.manual, ...saved.manual, thresholds: { ...defaults.manual.thresholds, ...saved.manual?.thresholds } },
    };
    validateAdditionalSettings(merged);
    return merged;
  } catch { return defaults; }
}

function NumericInput({ label, value, onChange, unit, scale = 1, min = 0, max, step = 'any', ...props }) {
  return <div className="flame-input-unit">
    <input aria-label={label} type="number" min={min} max={max} step={step} inputMode="decimal"
      value={value === '' || value === undefined || value === null ? '' : Number((value * scale).toPrecision(12))}
      onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value) / scale)} {...props} />
    {unit && <span>{unit}</span>}
  </div>;
}

function Estimate({ strategy, compact = false }) {
  return <div className={`flame-estimate-grid additional-estimates ${compact ? 'additional-estimates-compact' : ''}`}>
    <div><span>예상 추가 지출</span><strong className="flame-cost-value">{meso(strategy.expectedCost)}</strong></div>
    <div><span>종료 시 주스탯 환산</span><strong>{score(strategy.expectedFinalScore)}</strong></div>
    <div><span>현재 대비 예상 상승</span><strong className={strategy.expectedGain >= 0 ? 'flame-green' : 'additional-negative'}>{strategy.expectedGain > 0 ? '+' : ''}{score(strategy.expectedGain)}</strong></div>
    <div><span>예상 총 사용 횟수</span><strong>{number(strategy.expectedAttempts)}<small> 회</small></strong></div>
  </div>;
}

function Thresholds({ strategy, settings }) {
  const rows = strategy.allThresholds || strategy.thresholds || [];
  const visibleRows = ADDITIONAL_GRADES.map(grade => {
    const gradeRows = rows.filter(row => row.grade === grade);
    return gradeRows.find(row => row.stack === (settings.stacks[grade] || 0)) || gradeRows.find(row => row.stack === 0) || gradeRows[0];
  }).filter(Boolean);
  if (!visibleRows.length) return null;
  return <div className="additional-thresholds">
    <div className="flame-section-title"><h3>등급별 종료 기준</h3><span>현재 입력한 등급업 스택 기준</span></div>
    <div className="additional-grade-thresholds">{visibleRows.map(row => <div key={row.grade} className={`additional-grade-${row.grade}`}>
      <span>{row.grade}</span><b>{thresholdLabel(row.targetScore ?? row.threshold)}</b>
      <small>{row.action === 'mixed' ? '현재 옵션에 따라 수단 선택' : row.action === 'strange' ? '수상한 에디셔널 큐브' : row.action === 'stop' ? '종료' : '잠재능력 재설정'}{row.stack > 0 ? ` · ${row.stack}스택` : ''}</small>
    </div>)}</div>
    {rows.length > visibleRows.length && <details className="additional-stack-details"><summary>등급업 스택에 따른 기준 보기</summary>
      <div className="flame-table-scroll additional-stack-table"><table><thead><tr><th>등급</th><th>스택</th><th>종료 기준</th><th>기준 미만일 때</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row.grade}-${row.stack}-${index}`}><td>{row.grade}</td><td>{row.stack ?? 0}</td><td>{thresholdLabel(row.targetScore ?? row.threshold)}</td><td>{row.action === 'mixed' ? '옵션에 따라 수단 선택' : row.action === 'strange' ? '수에큐 사용' : row.action === 'stop' ? '유지' : '재설정'}</td></tr>)}</tbody>
      </table></div>
    </details>}
  </div>;
}

function GradeDistribution({ grades }) {
  const outcomes = Object.entries(grades || {}).filter(([, chance]) => chance > 1e-8);
  if (!outcomes.length) return null;
  return <div className="additional-final-grades"><span>종료 등급 확률</span><div>{outcomes.map(([grade, chance]) => <span key={grade} className={`additional-grade-${grade}`}><b>{grade}</b> {probability(chance)}</span>)}</div></div>;
}

export default function AdditionalPage() {
  const [settings, setSettings] = useState(loadSettings);
  const [result, setResult] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const worker = useRef(null);
  const request = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  let preview = null;
  try { const value = previewAdditionalScore(settings); preview = typeof value === 'number' ? value : value?.score; } catch {}
  let lines = null;
  try { lines = getAdditionalLines({ method: 'reset', grade: settings.grade, slot: settings.slot, level: settings.level }); } catch {}
  const paidRulesReady = !paidRulesIssue(settings);
  const recommended = result?.strategies?.find(strategy => strategy.id === result.recommendedId);
  const selected = result?.strategies?.find(strategy => strategy.id === selectedId) || recommended;
  const currentThreshold = selected?.thresholds?.find(row => row.grade === settings.grade && row.stack === (settings.stacks[settings.grade] || 0));
  const target = currentThreshold?.targetScore ?? currentThreshold?.threshold ?? selected?.threshold;
  const isStop = selected?.action === 'stop' || selected?.action === 'keep';

  useEffect(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(settings)); } catch {} }, [settings]);

  function change(patch) {
    request.current += 1;
    worker.current?.terminate();
    worker.current = null;
    setSettings(previous => ({ ...previous, ...patch }));
    setResult(null);
    setSelectedId(null);
    setBusy(false);
    setError('');
    setProgress('입력값이 바뀌었습니다. 전략을 다시 계산해 주세요.');
  }
  const changeNested = (key, name, value) => change({ [key]: { ...settings[key], [name]: value } });
  const changeItem = patch => change({ ...patch, ...(Object.hasOwn(patch, 'level') ? { costs: resetAdditionalCosts(patch.level), strangeAppraisalCost: suggestedAdditionalAppraisalCost(patch.level) } : {}), currentOptions: ['없음', '없음', '없음'] });

  function calculate() {
    try {
      const snapshot = settingsRef.current;
      validateAdditionalSettings(snapshot);
      worker.current?.terminate();
      const source = document.getElementById('additional-worker-source');
      if (!source) throw new Error('계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      const url = URL.createObjectURL(new Blob([JSON.parse(source.textContent)], { type: 'text/javascript' }));
      let engine;
      try { engine = new Worker(url); } finally { URL.revokeObjectURL(url); }
      worker.current = engine;
      const id = ++request.current;
      setBusy(true);
      setResult(null);
      setError('');
      setProgress('세 줄의 확률과 등급업을 반영해 재설정 전략을 비교하고 있습니다…');
      engine.onmessage = ({ data }) => {
        if (data.id !== request.current) return;
        if (data.type === 'progress') setProgress(data.message);
        if (data.type === 'result') {
          setResult(data.result);
          setSelectedId(data.result.recommendedId);
          setBusy(false);
          setProgress('계산 완료');
          engine.terminate();
          worker.current = null;
        }
        if (data.type === 'error') {
          setError(data.message || '계산하지 못했습니다. 입력값을 확인해 주세요.');
          setBusy(false);
          setProgress('');
          engine.terminate();
          worker.current = null;
        }
      };
      engine.onerror = () => {
        if (id !== request.current) return;
        setError('계산 엔진을 실행하지 못했습니다. 다시 계산해 주세요.');
        setBusy(false);
        setProgress('');
        engine.terminate();
        worker.current = null;
      };
      engine.postMessage({ id, settings: snapshot });
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
      setProgress('');
    }
  }

  useEffect(() => {
    calculate();
    return () => { request.current += 1; worker.current?.terminate(); };
  }, []);

  function efficiencyFields(rows) {
    return <div className="flame-efficiencies">{rows.map(item => <label key={item.key}>
      <span>{item.label} <b>{item.amount}</b></span><span className="flame-equal">=</span>
      <NumericInput label={`${item.label} ${item.amount}의 주스탯 환산 효율 (%)`} value={settings.efficiency[item.key] ?? 0}
        scale={item.scale} unit="%" onChange={value => changeNested('efficiency', item.key, value)} />
    </label>)}</div>;
  }

  return <main className="flame-page additional-page">
    <header className="flame-header">
      <div><div className="flame-eyebrow">ADDITIONAL POTENTIAL <span>방어구 · 장신구</span></div>
        <h1>에디셔널 <em>전략 계산기</em></h1>
        <p>주스탯 1%에 얼마까지 쓸 수 있나요?<br />수에큐부터 등급별 재설정까지, 내 장비에서 멈출 기준을 비교합니다.</p>
      </div>
      <div className="additional-cube-mark" aria-hidden="true"><span>◇</span><i /></div>
    </header>
    <div className="flame-layout additional-layout">
      <section className="flame-settings" aria-label="에디셔널 전략 계산 설정">
        <div className="flame-card">
          <div className="flame-section-title"><h2>현재 장비와 에디셔널</h2><span className="flame-pill">시작점</span></div>
          <div className="additional-field-grid">
            <label className="additional-field">장비 부위<select aria-label="대상 아이템 부위" value={settings.slot} onChange={event => changeItem({ slot: event.target.value })}>{ADDITIONAL_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</select></label>
            <label className="additional-field">레벨 제한<NumericInput label="아이템의 레벨 제한" value={settings.level} min={120} max={250} step="1" unit="레벨" onChange={value => changeItem({ level: value })} /></label>
          </div>
          <div className="flame-level-presets" aria-label="아이템 레벨 제한 빠른 입력">{ADDITIONAL_LEVELS.map(level => <button type="button" key={level} aria-pressed={settings.level === level} onClick={() => changeItem({ level })}>{level}</button>)}</div>
          <label className="additional-field additional-spaced">현재 에디셔널 등급<select aria-label="현재 에디셔널 잠재능력 등급" value={settings.grade} onChange={event => changeItem({ grade: event.target.value })}>{ADDITIONAL_GRADES.map(grade => <option key={grade}>{grade}</option>)}</select></label>
          <div className="additional-option-inputs">{[0, 1, 2].map(index => <label key={index}><span>{index + 1}번째 줄</span>
            <select aria-label={`현재 에디셔널 ${index + 1}번째 옵션`} value={settings.currentOptions[index]} disabled={!lines}
              onChange={event => change({ currentOptions: settings.currentOptions.map((value, line) => line === index ? event.target.value : value) })}>
              <option value="없음">없음 / 환산 가치 0</option>
              {lines?.[index].map(option => <option value={option.label} key={option.label}>{option.label}</option>)}
            </select>
          </label>)}</div>
          {!lines && <p className="additional-warning" role="status">선택한 부위·등급·레벨의 확률표가 없습니다. 제공된 자료의 지원 범위를 확인해 주세요.</p>}
          <div className="flame-current-score"><span>현재 주스탯 환산 합계</span><b>{score(preview)}</b></div>
          <p className="flame-small-note">장비 조건을 바꾸면 현재 옵션은 초기화됩니다. 제공 자료의 120~250레벨 구간을 지원합니다.</p>
        </div>

        <div className="flame-card">
          <div className="flame-section-title"><h2>캐릭터와 스탯 효율</h2><button className="flame-text-button" type="button" onClick={() => change({ efficiency: copy(DEFAULT_ADDITIONAL_SETTINGS.efficiency) })}>효율 기본값</button></div>
          <div className="additional-field-grid">
            <label className="additional-field">주스탯<select aria-label="캐릭터 주스탯" value={settings.mainStat} onChange={event => change({ mainStat: event.target.value, ...(event.target.value === settings.subStat ? { subStat: settings.mainStat } : {}) })}>{stats.map(stat => <option key={stat}>{stat}</option>)}</select></label>
            <label className="additional-field">부스탯<select aria-label="캐릭터 부스탯" value={settings.subStat} onChange={event => change({ subStat: event.target.value })}>{stats.filter(stat => stat !== settings.mainStat).map(stat => <option key={stat}>{stat}</option>)}</select></label>
            <label className="additional-field">유효 공격 스탯<select aria-label="공격력 또는 마력" value={settings.attackType} onChange={event => change({ attackType: event.target.value })}><option value="attack">공격력</option><option value="magic">마력</option></select></label>
            <label className="additional-field">캐릭터 레벨<NumericInput label="캐릭터 레벨" value={settings.characterLevel} min={1} max={300} step="1" unit="레벨" onChange={value => change({ characterLevel: value })} /></label>
          </div>
          <p className="flame-small-note">9레벨당 스탯 옵션은 레벨 ÷ 9의 정수 부분을 적용합니다. 레벨 290이면 32회분입니다.</p>
          {efficiencyFields(efficiencies)}
          <details className="additional-inline-details"><summary>기타 옵션의 환산 효율</summary>{efficiencyFields(optionalEfficiencies)}<p className="flame-small-note">캐릭터의 크리티컬 확률 상한 등은 자동 반영하지 않습니다. 가치가 없는 옵션은 0으로 두세요.</p></details>
          <p className="flame-small-note">오른쪽은 모두 주스탯 % 기준입니다. 올스탯 +10은 주스탯 +10과 부스탯 +10의 효율을 합산합니다. 별도 효율을 지정하지 않은 옵션의 가치는 0입니다.</p>
        </div>

        <div className="flame-card flame-price-card">
          <h2>주스탯 1%당 최대 비용</h2>
          <label className="flame-field-label">추가 주스탯 1%에 지불할 가치<NumericInput label="주스탯 1%당 지불할 최대 금액 (억 메소)" value={settings.mesoPerPercent} scale={1e-8} unit="억 메소 / 1%" onChange={value => change({ mesoPerPercent: value })} /></label>
          <p className="flame-small-note">총 지출 한도가 아닙니다. 예상 스탯 상승의 가치에서 비용을 뺀 기대값이 가장 큰 전략을 찾습니다.</p>
          <label className="flame-field-label">수상한 에디셔널 큐브 개당 가격<NumericInput label="수상한 에디셔널 큐브 개당 가격" value={settings.strangeCubePrice} unit="메소" onChange={value => change({ strangeCubePrice: value })} /></label>
          <label className="flame-field-label">수에큐 사용 후 1회 감정 비용<NumericInput label="수상한 에디셔널 큐브 감정 비용" value={settings.strangeAppraisalCost} unit="메소" onChange={value => change({ strangeAppraisalCost: value })} /></label>
          <div className="additional-cube-cost"><span>수에큐 1회 총 비용</span><b>{settings.strangeCubePrice === '' || settings.strangeAppraisalCost === '' ? '—' : meso(settings.strangeCubePrice + settings.strangeAppraisalCost)}</b></div>
          <p className="flame-small-note">큐브 가격이 0이어도 감정 비용이 매번 필요합니다. 기본 감정 비용은 레벨 제한² × 20메소(120레벨은 × 2.5)입니다. 120제에서 통찰력 90레벨 이상으로 무료 감정이 적용되면 0으로 수정하세요.</p>
          <label className="additional-check additional-miracle"><input type="checkbox" checked={settings.miracle} onChange={event => change({ miracle: event.target.checked })} /><span>미라클 타임<span>입력한 기본 등급업 확률의 2배 적용</span></span></label>
        </div>

        <details className="flame-card additional-rules">
          <summary><span>재설정 규칙</span><span className="additional-rule-badge">{paidRulesReady ? '자동 입력 · 조정 가능' : '입력 필요'}</span></summary>
          <p className="flame-small-note">제공된 재설정 비용표와 등급업 규칙을 기본으로 적용합니다. 레벨 제한을 바꾸면 재설정·감정 비용을 자동 갱신합니다. 할인 등으로 실제 비용이 다르면 직접 수정하세요.</p>
          <h3>등급별 재설정 1회 비용</h3>
          <div className="additional-rule-fields">{ADDITIONAL_GRADES.map(grade => <label key={grade}><span>{grade}</span><NumericInput label={`${grade} 에디셔널 재설정 비용`} value={settings.costs[grade]} unit="메소" onChange={value => changeNested('costs', grade, value)} /></label>)}</div>
          {['에픽', '유니크'].map((grade, index) => <div className="additional-upgrade-rule" key={grade}>
            <h3>{grade} → {ADDITIONAL_GRADES[index + 1]}</h3>
            <label className="additional-rule-row"><span>기본 등급업 확률</span><NumericInput label={`${grade} 기본 등급업 확률 (%)`} value={settings.upRates[grade]} scale={100} max={100} unit="%" onChange={value => changeNested('upRates', grade, value)} /></label>
            <label className="additional-rule-row"><span>확정 등급업까지 실패 횟수</span><NumericInput label={`${grade} 확정 등급업까지 실패 횟수`} value={settings.pity[grade]} step="1" unit="회" onChange={value => changeNested('pity', grade, value)} /></label>
            <label className="additional-rule-row"><span>현재 실패 스택</span><NumericInput label={`${grade} 현재 등급업 실패 스택`} value={settings.stacks[grade]} step="1" unit="회" onChange={value => changeNested('stacks', grade, value)} /></label>
          </div>)}
          <p className="flame-small-note">입력한 횟수만큼 등급업에 실패하면 다음 재설정에서 확정 등급업합니다. 0이면 다음 재설정에서 즉시 확정 등급업합니다. 현재 스택은 해당 등급에서 이미 누적한 등급업 실패 횟수입니다.</p>
          <label className="additional-check"><input type="checkbox" checked={settings.retainPaid} onChange={event => change({ retainPaid: event.target.checked })} /><span>같은 등급에서는 재설정 전·후 선택 가능</span></label>
          <p className="flame-small-note">같은 등급에서 이전 옵션을 선택할 수 있는 규칙을 반영합니다. 등급업하면 새 등급의 결과를 적용하는 모델입니다.</p>
        </details>
        <button className="flame-calculate" type="button" onClick={calculate}>{busy ? '현재 설정으로 다시 계산' : '에디셔널 전략 비교'}<span aria-hidden="true">→</span></button>
        <p className="flame-status" role="status" aria-live="polite">{progress}</p>
        {error && <p className="flame-error" role="alert">{error}</p>}
      </section>

      <section className="flame-results" aria-label="에디셔널 재설정 전략 비교 결과" aria-busy={busy}>
        {!result && <div className="flame-card flame-empty">
          <div className="flame-empty-icon" aria-hidden="true">◇</div><h2>{busy ? '등급별로 가장 유리한 종료 기준을 찾고 있습니다' : '내 에디셔널의 다음 한 번을 결정하세요'}</h2>
          <p>지금 멈출지, 에픽에서 타협할지, 더 높은 등급까지 갈지.<br />현재 옵션과 스탯 가치를 함께 반영해 비교합니다.</p>
          {busy && <div className="flame-progress" />}
          <div className="flame-empty-steps"><span>현재 옵션</span><i>＋</i><span>등급업 확률</span><i>＋</i><span>상승분의 가치</span></div>
        </div>}

        {result && <>
          <p className="additional-model-note">줄별 공개 확률을 결합한 근사 계산입니다. 자세한 가정은 아래 계산 방법에서 확인할 수 있습니다.</p>
          <section className="flame-card additional-strategies"><div className="flame-section-title"><h2>전략별 비교</h2><span>예상 순가치가 높은 전략 추천</span></div>
            <p className="flame-muted">예상 순가치 = 예상 상승 주스탯 % × 1%당 가치 − 예상 추가 지출</p>
            <div className="additional-strategy-list">{result.strategies?.map(strategy => <button type="button" key={strategy.id} disabled={!strategy.available} aria-pressed={selected?.id === strategy.id} onClick={() => setSelectedId(strategy.id)}>
              <div><span className="additional-strategy-name">{strategy.label}{strategy.id === result.recommendedId && <i>추천</i>}</span><span className="additional-strategy-meta">{strategy.available ? `${actionLabel(strategy.action)} · 예상 비용 ${meso(strategy.expectedCost)}` : strategy.reason || '현재 조건에서 사용할 수 없습니다.'}</span></div>
              <span className="additional-strategy-value">{strategy.available ? meso(strategy.expectedNetValue) : '계산 제외'}{strategy.available && <small>예상 순가치</small>}</span>
            </button>)}</div>
          </section>

          {selected?.available && <>
            <div className={`flame-card flame-recommendation ${isStop ? 'flame-keep' : ''}`}>
              <div className="flame-section-title"><span className="flame-pill">{selected.id === result.recommendedId ? '추천 전략' : '선택한 전략'}</span><span>{selected.label}</span></div>
              {isStop ? <div className="flame-no-budget">입력한 주스탯 가치에서는<br /><strong>현재 옵션을 유지하세요</strong></div>
                : Number.isFinite(target) ? <div className="flame-threshold"><strong>{number(target, 4)}<small>%</small></strong><span>현재 등급에서 종료 기준</span></div>
                : <div className="flame-no-budget"><strong>{target === Infinity ? '다음 등급까지 재설정' : actionLabel(selected.action)}</strong></div>}
              <div className="flame-action"><span className="flame-action-symbol" aria-hidden="true">{isStop ? '✓' : '↻'}</span><div><span>현재 {settings.grade} · 환산 {score(result.currentScore)}</span><h2>{actionLabel(selected.action)}</h2><p>{isStop ? '추가 재설정으로 얻을 상승분의 기대 가치가 비용보다 크지 않습니다.' : '각 결과의 세 줄 환산 합계를 확인하세요. 등급이 오르거나 스택이 쌓이면 해당 상태의 종료 기준을 적용합니다.'}</p></div></div>
              <Thresholds strategy={selected} settings={settings} />
              {!!currentThreshold?.actionRanges?.length && <details className="additional-stack-details"><summary>현재 등급·스택의 점수별 행동 보기</summary>
                <div className="flame-table-scroll"><table><thead><tr><th>획득 가능한 환산값 범위</th><th>다음 행동</th></tr></thead><tbody>{currentThreshold.actionRanges.map((range, index) => <tr key={index}>
                  <td>{score(range.minScore)}{range.maxScore !== range.minScore ? ` ~ ${score(range.maxScore)}` : ''}</td><td>{actionLabel(range.action)}</td>
                </tr>)}</tbody></table></div><p className="flame-small-note">이 구간은 실제로 나올 수 있는 옵션 점수를 묶은 것입니다. 누적 실패 스택이 바뀌면 행동 기준도 바뀔 수 있습니다.</p>
              </details>}
            </div>
            <section className="flame-card"><div className="flame-section-title"><h2>여기서부터 예상되는 결과</h2><span>평균값 · 보장 수치 아님</span></div>
              <Estimate strategy={selected} />
              <div className="additional-attempt-split"><span>수상한 에디셔널 큐브 <b>{number(selected.expectedStrangeAttempts)}회</b></span><span>잠재능력 재설정 <b>{number(selected.expectedResetAttempts)}회</b></span></div>
              <GradeDistribution grades={selected.finalGrades} />
              <p className="flame-small-note">예상 지출은 최대 지출이 아닙니다. 큐브 공급과 사용 횟수에 제한을 두지 않습니다. 무료 큐브도 감정 비용이 필요하며, 목표까지 많은 횟수가 필요할 수 있습니다.</p>
            </section>
            {!!selected.examples?.length && <section className="flame-card"><div className="flame-section-title"><h2>종료 기준을 만족하는 옵션 예시</h2><span>세 줄의 환산 합계</span></div>
              <div className="additional-examples">{selected.examples.slice(0, 6).map((example, index) => <div key={index}><ol>{example.options.map((option, line) => <li key={line}>{option}</li>)}</ol><b>{score(example.score)}</b></div>)}</div>
              <p className="flame-small-note">확률 분포에서 선택한 대표 조합입니다. 표시되지 않은 조합도 세 줄의 환산 합계로 판단하세요.</p>
            </section>}
          </>}
        </>}

        <section className="flame-card additional-manual"><div className="flame-section-title"><h2>내가 정한 x%급 전략</h2><span>직접 정한 종료 기준 비교</span></div>
          <p className="flame-muted">에픽에서 적당히 멈추거나, 유니크·레전드리에서는 더 높은 옵션을 노리는 기준을 직접 비교해 보세요.</p>
          <label className="additional-check"><input type="checkbox" checked={settings.manual.enabled} onChange={event => changeNested('manual', 'enabled', event.target.checked)} /><span>직접 정한 종료 기준도 함께 계산</span></label>
          {settings.manual.enabled && <div className="additional-manual-controls">
            <label className="additional-field">사용할 방법<select aria-label="직접 정한 전략의 재설정 방법" value={settings.manual.method} onChange={event => changeNested('manual', 'method', event.target.value)}><option value="reset">에디셔널 잠재능력 재설정</option><option value="strange">수상한 에디셔널 큐브</option></select></label>
            <label className="additional-field">모든 등급에 같은 기준 적용<NumericInput label="모든 등급의 동일 종료 기준" value={new Set(Object.values(settings.manual.thresholds)).size === 1 ? settings.manual.thresholds['에픽'] : ''} placeholder="일괄 입력" unit="% 이상" onChange={value => changeNested('manual', 'thresholds', Object.fromEntries(ADDITIONAL_GRADES.map(grade => [grade, value])))} /></label>
            <div className="additional-manual-grades">{ADDITIONAL_GRADES.map(grade => <label className={`additional-field additional-grade-${grade}`} key={grade}>{grade}<NumericInput label={`${grade} 직접 정한 종료 기준`} value={settings.manual.thresholds[grade]} unit="% 이상" onChange={value => changeNested('manual', 'thresholds', { ...settings.manual.thresholds, [grade]: value })} /></label>)}</div>
            <p className="flame-small-note">입력 후 ‘에디셔널 전략 비교’를 눌러 계산하세요. 수에큐는 에픽 종료 기준만 적용합니다. 수에큐와 메소 중 매번 유리한 수단을 고르는 전략은 위의 최적 선택 결과에서 확인할 수 있습니다.</p>
            <button className="flame-calculate additional-manual-calculate" type="button" onClick={calculate}>직접 정한 전략 계산<span aria-hidden="true">→</span></button>
            {result?.manual && <div className="additional-manual-result">{result.manual.available ? <><h3>직접 정한 전략의 예상 결과</h3><Estimate strategy={result.manual} compact /><p className="additional-manual-value">예상 순가치 <b>{meso(result.manual.expectedNetValue)}</b></p><GradeDistribution grades={result.manual.finalGrades} /></> : <p className="additional-warning">{result.manual.reason || '이 조건으로는 설정한 종료 기준에 도달할 수 없습니다.'}</p>}</div>}
          </div>}
        </section>

        <details className="flame-card flame-assumptions additional-assumptions"><summary>계산 방법·지원 범위와 확률 출처</summary>
          <ul>
            {result?.warnings?.map((warning, index) => <li key={index}>{warning}</li>)}
            <li>첨부된 수상한 에디셔널 큐브 및 에디셔널 잠재능력 재설정 확률표의 방어구·장신구를 사용합니다. 무기·보조무기·엠블렘은 제외합니다. 수에큐는 에픽 등급에서만 비교합니다.</li>
            <li>주스탯 한 종류, 부스탯 한 종류와 공격력·마력 중 하나의 효율을 반영합니다. 주스탯 %는 그대로 합산하고, 레벨 비례·고정 스탯·올스탯 옵션은 입력한 효율로 환산합니다.</li>
            <li>공개된 줄별 확률의 반올림 오차를 정규화해 조합합니다. 첨부 문서의 중복 제한 대상은 이 옵션 풀에 없습니다. 직전과 완전히 동일한 결과를 제외하는 규칙은 반영하지 않습니다.</li>
            <li>추천은 예상 상승분의 가치에서 앞으로 쓸 비용을 뺀 기대값을 최대화합니다. 이미 지출한 금액은 반영하지 않습니다. 수에큐 비용에는 개당 가격과 매회 감정 비용을 함께 반영하며, 큐브 공급 제한은 두지 않습니다.</li>
            <li>유료 재설정은 입력한 등급업 확률·확정 등급업까지 실패 횟수·현재 실패 스택을 반영합니다. 미라클 타임은 기본 확률의 2배, 최대 100%로 적용합니다. 할인은 1회 비용에 직접 반영해 주세요.</li>
            <li>스탯 상한, 직업별 특수 효과, 지정하지 않은 유틸리티 옵션의 가치는 자동 반영하지 않습니다. 실제 지출은 기대값보다 커질 수 있으며 총 예산 제한은 지원하지 않습니다.</li>
          </ul>
          <div className="flame-source-links">{ADDITIONAL_SOURCES.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}<a href="https://namu.wiki/w/%EC%9E%A0%EC%9E%AC%EB%8A%A5%EB%A0%A5" target="_blank" rel="noreferrer">비용·등급업 참고 문서 ↗</a></div>
        </details>
      </section>
    </div>
    <footer className="flame-footer">메이플 계산기 · 입력값은 이 브라우저에 자동 저장됩니다.</footer>
  </main>;
}
