import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FLAME_SETTINGS, validateFlameSettings, resetCostForLevel, FLAME_SOURCES } from './flame-data.mjs';
import './flame.css';

const SAVE_KEY = 'maple:flame:settings:v1';
const copy = value => JSON.parse(JSON.stringify(value));
const number = (value, digits = 2) => Number.isFinite(value)
  ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
const score = value => `${number(value, 4)}%`;
const probability = value => `${number(value * 100, 3)}%`;
const meso = value => {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e8) return `${number(value / 1e8)}억 메소`;
  if (value >= 1e4) return `${number(value / 1e4)}만 메소`;
  return `${number(value, 0)} 메소`;
};
const stats = [
  { key: 'main', label: '주스텟', unit: '', scale: 10 },
  { key: 'sub', label: '부스텟', unit: '', scale: 10 },
  { key: 'attack', label: '공격력 / 마력', unit: '', scale: 10 },
  { key: 'all', label: '올스텟', unit: '%', scale: 1 },
];

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    validateFlameSettings(saved);
    return saved;
  } catch {
    return copy(DEFAULT_FLAME_SETTINGS);
  }
}

function currentScore(settings) {
  if (stats.some(({ key }) => settings.current[key] === '' || settings.efficiencies[key] === '')) return null;
  return stats.reduce((total, { key, scale }) => total + settings.current[key] * settings.efficiencies[key] / scale, 0);
}

function StatInput({ stat, value, onChange }) {
  return <label className="flame-stat-input">
    <span>{stat.label}</span>
    <div className="flame-input-unit">
      <input aria-label={`현재 추가옵션 ${stat.label}`} type="number" min="0" step="1" inputMode="decimal"
        value={value} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
      {stat.unit && <span>{stat.unit}</span>}
    </div>
  </label>;
}

function ScoreComparison({ current, target }) {
  const largest = Math.max(current, target, 1);
  return <div className="flame-score-comparison" aria-label="현재 추가옵션과 종료 기준 비교">
    <div><span>현재 추가옵션</span><b>{score(current)}</b><div className="flame-score-track"><i style={{ width: `${Math.min(current / largest, 1) * 100}%` }} /></div></div>
    <div className="flame-target-bar"><span>종료 기준</span><b>{score(target)}</b><div className="flame-score-track"><i style={{ width: `${Math.min(target / largest, 1) * 100}%` }} /></div></div>
  </div>;
}

function OptionExamples({ examples }) {
  if (!examples?.length) return null;
  return <section className="flame-card">
    <div className="flame-section-title"><h2>이런 추가옵션이면 멈추세요</h2><span>종료 기준을 만족하는 예시</span></div>
    <p className="flame-muted">각 수치를 함께 얻은 조합입니다. 한 옵션만 보고 판단하지 말고, 네 옵션의 환산 합계를 확인하세요.</p>
    <div className="flame-table-scroll"><table><thead><tr><th>주스텟</th><th>부스텟</th><th>공격력·마력</th><th>올스텟</th><th>환산 주스텟</th></tr></thead>
      <tbody>{examples.map((example, index) => <tr key={index}>
        <td>{number(example.stats.main)}</td><td>{number(example.stats.sub)}</td><td>{number(example.stats.attack)}</td><td>{number(example.stats.all)}%</td><td><b>{score(example.score)}</b></td>
      </tr>)}</tbody></table></div>
    <p className="flame-small-note">가능한 조합 중 일부입니다. 표에 없는 결과도 환산 합계가 종료 기준 이상이면 멈출 수 있습니다.</p>
  </section>;
}

export default function FlamePage() {
  const [settings, setSettings] = useState(loadSettings);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const worker = useRef(null);
  const request = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const preview = currentScore(settings);
  let resetCost;
  try { resetCost = settings.itemLevel === '' ? null : resetCostForLevel(settings.itemLevel); } catch { resetCost = null; }

  useEffect(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  function change(patch) {
    request.current += 1;
    worker.current?.terminate();
    worker.current = null;
    setSettings(previous => ({ ...previous, ...patch }));
    setResult(null);
    setBusy(false);
    setError('');
    setProgress('입력값이 바뀌었습니다. 종료 기준을 다시 계산해 주세요.');
  }

  function calculate() {
    try {
      const snapshot = settingsRef.current;
      validateFlameSettings(snapshot);
      worker.current?.terminate();
      const source = document.getElementById('flame-worker-source');
      if (!source) throw new Error('계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      const url = URL.createObjectURL(new Blob([JSON.parse(source.textContent)], { type: 'text/javascript' }));
      let engine;
      try { engine = new Worker(url); } finally { URL.revokeObjectURL(url); }
      worker.current = engine;
      const id = ++request.current;
      setBusy(true);
      setResult(null);
      setError('');
      setProgress('추가옵션 확률을 비교하고 종료 기준을 계산하고 있습니다…');
      engine.onmessage = ({ data }) => {
        if (data.id !== request.current) return;
        if (data.type === 'progress') setProgress(data.message);
        if (data.type === 'result') {
          setResult(data.result);
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

  const mainEquivalent = result && result.targetScore !== null && settings.efficiencies.main > 0
    ? result.targetScore * 10 / settings.efficiencies.main : null;

  return <main className="flame-page">
    <header className="flame-header">
      <div><div className="flame-eyebrow">BONUS STAT STRATEGY <span>보스 방어구 · 장신구</span></div>
        <h1>추가옵션 <em>효율 계산기</em></h1>
        <p>주스텟 1%에 얼마까지 쓸 수 있나요?<br />내 스텟 효율과 재설정 비용으로 적절한 종료 기준을 계산합니다.</p>
      </div>
      <div className="flame-header-mark" aria-hidden="true"><span>✦</span><i /></div>
    </header>
    <div className="flame-layout">
      <section className="flame-settings" aria-label="추가옵션 계산 설정">
        <div className="flame-card">
          <div className="flame-section-title"><h2>현재 추가옵션</h2><span className="flame-pill">시작점</span></div>
          <p className="flame-muted">단일·이중 스텟 옵션을 합쳐, 장비에 붙은 추가옵션 수치를 입력하세요.</p>
          <div className="flame-stat-grid">{stats.map(stat => <StatInput key={stat.key} stat={stat} value={settings.current[stat.key]}
            onChange={value => change({ current: { ...settings.current, [stat.key]: value } })} />)}</div>
          <div className="flame-current-score"><span>현재 주스텟 환산 합계</span><b>{score(preview)}</b></div>
        </div>
        <div className="flame-card">
          <h2>재설정 대상 장비</h2>
          <label className="flame-field-label">아이템의 레벨 제한
            <div className="flame-input-unit"><input aria-label="아이템의 레벨 제한" type="number" min="1" max="300" step="1" inputMode="numeric"
              value={settings.itemLevel} onChange={event => change({ itemLevel: event.target.value === '' ? '' : Number(event.target.value) })} /><span>레벨</span></div>
          </label>
          <div className="flame-level-presets" aria-label="레벨 제한 빠른 입력">{[140, 150, 160, 200, 250].map(level => <button type="button" key={level} aria-pressed={settings.itemLevel === level}
            onClick={() => change({ itemLevel: level })}>{level}</button>)}</div>
          <div className="flame-reset-cost"><span>추가옵션 재설정 1회</span><b>{meso(resetCost)}</b></div>
          <p className="flame-small-note">레벨 제한은 추가옵션 수치에 반영됩니다. 재설정 비용은 레벨과 관계없이 300만 메소입니다.</p>
          <p className="flame-small-note">보스 방어구·장신구의 추가옵션을 계산합니다. 무기는 계산 대상에서 제외합니다.</p>
        </div>
        <div className="flame-card">
          <div className="flame-section-title"><h2>내 스텟 효율</h2><button className="flame-text-button" type="button" onClick={() => change({ efficiencies: copy(DEFAULT_FLAME_SETTINGS.efficiencies) })}>기본값</button></div>
          <p className="flame-muted">아래 수치가 주스텟 몇 %만큼 효과가 있는지 입력하세요.</p>
          <div className="flame-efficiencies">{stats.map(stat => <label key={stat.key}>
            <span>{stat.label} <b>{stat.scale}{stat.unit}</b></span><span className="flame-equal">=</span>
            <div className="flame-input-unit"><input aria-label={`${stat.label} ${stat.scale}${stat.unit}의 주스텟 환산 효율 (%)`} type="number" min="0" step="any" inputMode="decimal"
              value={settings.efficiencies[stat.key]} onChange={event => change({ efficiencies: { ...settings.efficiencies, [stat.key]: event.target.value === '' ? '' : Number(event.target.value) } })} /><span>%</span></div>
          </label>)}</div>
          <p className="flame-small-note">오른쪽 숫자는 모두 주스텟 % 기준입니다.</p>
        </div>
        <div className="flame-card flame-price-card">
          <h2>주스텟 1%당 최대 비용</h2>
          <label className="flame-field-label">추가로 주스텟 1%를 얻는 데 쓸 금액
            <div className="flame-input-unit"><input aria-label="주스텟 1%당 지불할 최대 금액 (억 메소)" type="number" min="0" step="any" inputMode="decimal"
              value={settings.mesoPerPercent === '' ? '' : settings.mesoPerPercent / 1e8}
              onChange={event => change({ mesoPerPercent: event.target.value === '' ? '' : Number(event.target.value) * 1e8 })} /><span>억 메소 / 1%</span></div>
          </label>
          <p className="flame-small-note">총 예산이 아닌 스텟 상승분의 가치입니다. 높게 입력할수록 더 좋은 추가옵션까지 재설정합니다.</p>
        </div>
        <button className="flame-calculate" type="button" onClick={calculate}>{busy ? '현재 설정으로 다시 계산' : '멈출 추가옵션 계산'}<span aria-hidden="true">→</span></button>
        <p className="flame-status" role="status" aria-live="polite">{progress}</p>
        {error && <p className="flame-error" role="alert">{error}</p>}
      </section>
      <section className="flame-results" aria-label="추가옵션 종료 기준 계산 결과" aria-busy={busy}>
        {!result && <div className="flame-card flame-empty">
          <div className="flame-empty-icon" aria-hidden="true">✦</div>
          <h2>{busy ? '내 장비의 종료 기준을 계산하고 있습니다' : '입력한 가치로 종료 기준을 계산해 주세요'}</h2>
          <p>현재 추가옵션을 유지할지, 재설정할지와<br />얼마나 좋은 옵션에서 멈추면 되는지 확인할 수 있습니다.</p>
          {busy && <div className="flame-progress" />}
          <div className="flame-empty-steps"><span>스텟 효율</span><i>＋</i><span>재설정 비용</span><i>＋</i><span>상승분의 가치</span></div>
        </div>}
        {result && <>
          <div className={`flame-card flame-recommendation ${result.shouldReset ? 'flame-reset' : 'flame-keep'}`}>
            <div className="flame-section-title"><span className="flame-pill">추천 종료 기준</span><span>주스텟 % 환산</span></div>
            {result.targetScore === null
              ? <div className="flame-no-budget">추가 지출 없이<br /><strong>현재 옵션을 유지하세요</strong></div>
              : <div className="flame-threshold"><strong>{number(result.targetScore, 4)}<small>%</small></strong><span>이상에서 멈추세요</span></div>}
            {mainEquivalent !== null && <p className="flame-equivalent">주스텟만으로 채운다면 약 <b>{number(mainEquivalent, 1)}</b>에 해당합니다.</p>}
            <div className="flame-action"><span className="flame-action-symbol" aria-hidden="true">{result.shouldReset ? '↻' : '✓'}</span><div><span>현재 추가옵션에서</span><h2>{result.shouldReset ? '추가옵션 재설정' : '현재 옵션 유지'}</h2><p>{result.shouldReset
              ? `종료 기준까지 ${score(Math.max(0, result.targetScore - result.currentScore))}가 부족합니다. 재설정의 기대 가치가 비용보다 큽니다.`
              : settings.mesoPerPercent === 0
                ? '주스텟 상승분에 비용을 배정하지 않았으므로, 유료 재설정을 진행하지 않습니다.'
                : '추가 상승분의 기대 가치가 재설정 비용을 넘지 않습니다. 입력한 스텟 가치에서는 여기서 멈추는 것이 유리합니다.'}</p></div></div>
            {result.targetScore !== null && <ScoreComparison current={result.currentScore} target={result.targetScore} />}
          </div>
          <section className="flame-card">
            <div className="flame-section-title"><h2>여기서부터 예상되는 결과</h2><span>평균값 · 보장 수치 아님</span></div>
            <div className="flame-estimate-grid">
              <div><span>예상 재설정 횟수</span><strong>{number(result.expectedAttempts)}<small> 회</small></strong></div>
              <div><span>예상 추가 지출</span><strong className="flame-cost-value">{meso(result.expectedCost)}</strong></div>
              <div><span>종료 시 주스텟 환산</span><strong>{score(result.expectedFinalScore)}</strong></div>
              <div><span>현재 대비 예상 상승</span><strong className="flame-green">+{score(result.expectedGain)}</strong></div>
            </div>
            <div className="flame-acceptance"><span>1회 재설정에서 종료 기준을 만족할 확률</span><b>{probability(result.acceptanceProbability)}</b></div>
            <p className="flame-small-note">{result.shouldReset ? '매번 결과를 확인하며 종료 기준에 도달할 때까지 재설정하는 경우입니다. 실제 소모 비용은 운에 따라 크게 달라질 수 있습니다.' : '계산 결과에 따라 추가 지출 없이 현재 옵션을 유지하는 경우입니다.'}</p>
          </section>
          <OptionExamples examples={result.examples} />
          {result.targetScore !== null && <section className="flame-card flame-score-guide">
            <div className="flame-section-title"><h2>실제 옵션은 이렇게 비교하세요</h2><span>네 옵션의 합계</span></div>
            <p className="flame-muted">각 옵션을 주스텟 %로 바꾼 뒤 모두 더합니다. 새로운 결과가 {score(result.targetScore)} 이상이면 종료 기준에 도달한 것입니다.</p>
            <div className="flame-formula">주스텟 ÷ 10 × {number(settings.efficiencies.main, 4)}<br />＋ 부스텟 ÷ 10 × {number(settings.efficiencies.sub, 4)}<br />＋ 공격력·마력 ÷ 10 × {number(settings.efficiencies.attack, 4)}<br />＋ 올스텟 % × {number(settings.efficiencies.all, 4)}<span>= 환산 주스텟 %</span></div>
            <p className="flame-small-note">올스텟 효율에는 주스텟·부스텟에 대한 효과를 함께 반영하세요. 장비의 기본 스텟과 잠재능력은 이 계산에 입력하지 않습니다.</p>
          </section>}
          <details className="flame-card flame-assumptions">
            <summary>계산 기준과 공식 확률 출처</summary>
            <ul>
              <li>보스 장비 방어구·장신구의 메소 추가옵션 재설정을 기준으로 합니다. 공격력·마력은 해당 캐릭터에 유효한 한 종류만 계산합니다.</li>
              <li>아이템의 레벨 제한에 따른 옵션 수치와 옵션 종류·등급 확률을 적용합니다. 2026년 3월 19일 업데이트 이후 재설정 비용은 레벨과 관계없이 300만 메소입니다. 부스텟은 해당 캐릭터의 한 종류를 기준으로 입력합니다.</li>
              <li>스텟 상승분에 입력한 1%당 금액을 곱한 가치에서 앞으로 쓸 재설정 비용을 뺀 기대값이 가장 커지는 종료 기준을 찾습니다.</li>
              {result.threshold !== null && <li>계산상 연속적인 종료 경계는 주스텟 환산 {score(result.threshold)}입니다. 화면의 종료 기준은 이 경계 이상에서 실제로 나올 수 있는 가장 낮은 환산 점수입니다.</li>}
              <li>입력은 유효 스텟 합계이므로, 공식 확률표의 완전히 동일한 결과 재추첨은 기본 분포 모델에서 생략합니다. 환산 점수만 같은 다른 옵션 조합은 포함합니다.</li>
              <li>총 예산 제한과 이벤트 할인은 반영하지 않습니다. 기댓값은 여러 번 반복했을 때의 평균으로, 한 장비의 최대 지출을 뜻하지 않습니다.</li>
            </ul>
            <div className="flame-source-links">{FLAME_SOURCES.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
          </details>
        </>}
      </section>
    </div>
    <footer className="flame-footer">메이플 계산기 · 입력값은 이 브라우저에 자동 저장됩니다.</footer>
  </main>;
}
