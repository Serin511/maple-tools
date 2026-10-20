import { useId } from 'react';
import { ADDITIONAL_SUBSTATS, DEFAULT_ADDITIONAL_EFFICIENCY } from './additional-data.mjs';

/** Shared page framing keeps calculator navigation and headings consistent. */
export function CalculatorHeader({ eyebrow, scope, title, description, className = '' }) {
  return <header className={`calculator-header ${className}`.trim()}>
    <div className="calculator-eyebrow">
      <span>{eyebrow}</span>
      {scope && <span className="calculator-scope">{scope}</span>}
    </div>
    <h1>{title}</h1>
    <p className="calculator-description">{description}</p>
  </header>;
}

export function CalculatorFooter({ children, className = '' }) {
  return <footer className={`calculator-footer ${className}`.trim()}>
    {children || '메이플 계산기 · 입력값은 이 브라우저에 자동 저장됩니다.'}
  </footer>;
}

export function CalculatorCard({ as: Element = 'section', className = '', children, ...props }) {
  return <Element className={`calculator-card ${className}`.trim()} {...props}>{children}</Element>;
}

export function CalculateButton({ className = '', children, type = 'button', ...props }) {
  return <button className={`calculate-button ${className}`.trim()} type={type} {...props}>{children}</button>;
}

/** Settings presets share save/select/delete behavior and keyboard shortcuts. */
export function PresetControls({ names, presetName, setPresetName, selectedName, onSelect, onSave, onDelete }) {
  return <div className="calculator-presets">
    <div className="calculator-preset-controls">
      <input aria-label="저장할 프리셋 이름" value={presetName} placeholder="프리셋 이름"
        onChange={event => setPresetName(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && presetName.trim()) { event.preventDefault(); onSave(); }
        }} />
      <button type="button" disabled={!presetName.trim()} onClick={onSave}>현재 입력 저장</button>
    </div>
    <div className="calculator-preset-controls">
      <select aria-label="저장된 프리셋" value={selectedName} onChange={event => onSelect(event.target.value)}>
        <option value="">{names.length ? '프리셋 선택 → 즉시 적용' : '저장된 프리셋 없음'}</option>
        {names.map(name => <option key={name}>{name}</option>)}
      </select>
      <button type="button" disabled={!selectedName} onClick={onDelete}>삭제</button>
    </div>
  </div>;
}

/** Numeric controls use the same scaling, empty-value and unit behavior. */
export function NumericField({ label, value, onChange, unit, scale = 1, min = 0, max, step = 'any', className = '', ...props }) {
  const displayed = typeof value === 'number' && Number.isFinite(value) ? Number((value * scale).toPrecision(12)) : '';
  return <span className={`calculator-input-unit ${className}`.trim()}>
    <input aria-label={label} type="number" min={min} max={max} step={step} inputMode="decimal" value={displayed}
      onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value) / scale)} {...props} />
    {unit && <span className="calculator-input-suffix">{unit}</span>}
  </span>;
}

const TRADE_EQUIPMENT_LABELS = Object.freeze({
  purchase: '노작 매입가 (억 메소)',
  level: '레벨 제한',
  part: '착용 부위',
  startGrade: '시작 등급',
  fee: '경매장 수수료 (%)',
  floorPrice: '레전 깡통·잡옵 처분가 (억, 폴백용)',
});

/** Trading calculators share the equipment workflow; monetary values use meso. */
export function TradeEquipmentSettings({ values, onChange, levelOptions, partOptions, startGradeOptions,
  pityFields = [], labels = {}, purchaseLabel = TRADE_EQUIPMENT_LABELS.purchase, purchaseHelp,
  floorLabel = TRADE_EQUIPMENT_LABELS.floorPrice, floorHelp, children, className = '' }) {
  const fieldLabel = key => labels[key] || TRADE_EQUIPMENT_LABELS[key];
  const selectValue = (key, options, event) => {
    const option = options.find(item => String(item.value) === event.target.value);
    if (option) onChange({ [key]: option.value });
  };
  return <CalculatorCard className={`calculator-trade-equipment ${className}`.trim()}>
    <h2>장비 설정</h2>
    <label className="calculator-trade-field">{purchaseLabel}
      <NumericField label={labels.purchase || purchaseLabel} value={values.itemPrice} scale={1e-8}
        onChange={itemPrice => onChange({ itemPrice })} />
      {purchaseHelp && <span className="calculator-trade-help">{purchaseHelp}</span>}
    </label>
    <label className="calculator-trade-field">{TRADE_EQUIPMENT_LABELS.level}
      <select aria-label={fieldLabel('level')} value={values.level} onChange={event => selectValue('level', levelOptions, event)}>
        {levelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    {partOptions && <label className="calculator-trade-field">{TRADE_EQUIPMENT_LABELS.part}
      <select aria-label={fieldLabel('part')} value={values.part} onChange={event => selectValue('part', partOptions, event)}>
        {partOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>}
    {startGradeOptions && <label className="calculator-trade-field">{TRADE_EQUIPMENT_LABELS.startGrade}
      <select aria-label={fieldLabel('startGrade')} value={values.startGrade}
        onChange={event => selectValue('startGrade', startGradeOptions, event)}>
        {startGradeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>}
    <PityStackFields fields={pityFields} />
    <label className="calculator-trade-field">{TRADE_EQUIPMENT_LABELS.fee}
      <NumericField label={fieldLabel('fee')} value={values.fee} max={100} onChange={fee => onChange({ fee })} />
    </label>
    <label className="calculator-trade-field">{floorLabel}
      <NumericField label={labels.floorPrice || labels.floor || floorLabel} value={values.floorPrice}
        scale={1e-8} onChange={floorPrice => onChange({ floorPrice })} />
      {floorHelp && <span className="calculator-trade-help">{floorHelp}</span>}
    </label>
    {children}
  </CalculatorCard>;
}

/** Per-grade costs stay visible and editable beside the equipment settings. */
export function TradeResetCostSettings({ costs, note, title = '재설정 비용', className = '' }) {
  return <CalculatorCard className={`calculator-trade-reset-costs ${className}`.trim()}>
    <h2>{title}</h2>
    {costs.map(cost => <label className="calculator-trade-cost-row" key={cost.key}>
      <span style={{ color: cost.color }}>{cost.label}</span>
      <NumericField label={cost.ariaLabel || `${cost.label} 재설정 비용 (메소)`} value={cost.value} onChange={cost.onChange} />
    </label>)}
    {note && <p className="calculator-trade-help">{note}</p>}
  </CalculatorCard>;
}

export function PityStackFields({ fields }) {
  return fields.map(field => <label className="calculator-trade-field" key={field.key}>{field.label}
    <NumericField label={field.ariaLabel || field.label} value={field.value} max={field.max} step="1"
      inputMode="numeric" onChange={field.onChange} />
  </label>);
}

/** A shared switch keeps trading policy controls consistent and accessible. */
export function ToggleField({ on, onChange, label, color = 'var(--ui-accent)', description }) {
  const descriptionId = useId();
  return <div className="calculator-toggle-field">
    <button type="button" className="calculator-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      aria-describedby={description ? descriptionId : undefined}
      style={{ '--calculator-toggle-color': color }}>
      <span className="calculator-toggle-track" aria-hidden="true"><span /></span>
      <span>{label}</span>
    </button>
    {description && <p id={descriptionId} className="calculator-toggle-description">{description}</p>}
  </div>;
}

const primeMeso = value => {
  if (!Number.isFinite(value)) return '—';
  const amount = Math.abs(value);
  const scale = amount >= 1e8 ? 1e8 : amount >= 1e4 ? 1e4 : 1;
  const unit = scale === 1e8 ? '억' : scale === 1e4 ? '만' : '';
  return `${(value / scale).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${unit} 메소`;
};

/** Prime calculators share the same first-line selection and result feedback. */
export function PrimeOptimizationSummary({ optimization, automatic = false }) {
  if (!optimization) return null;
  const { selectedFixedLabel, bestFixedLabel, reason } = optimization;
  const value = optimization.objectiveValue ?? optimization.value ?? optimization.profitPerReset;
  const improvement = optimization.improvement ?? optimization.improvementPerReset
    ?? (Number.isFinite(value) && Number.isFinite(optimization.baselineValue) ? value - optimization.baselineValue : undefined);
  const objectiveLabel = optimization.objectiveLabel || '재설정 1회당 기대 이득';
  return <div className="calculator-prime-result" role="status">
    <strong>{automatic ? '자동 최적화 결과' : '프라임 비교 결과'}</strong>
    <p>{reason === 'no-targets' ? '레전드리 판매가를 입력하면 고정 옵션을 비교합니다.'
      : reason === 'non-selling' ? '최적 정책에서는 판매하지 않고 프라임 재설정을 계속합니다. 매물당 기대 수익을 계산할 수 없습니다.'
      : reason === 'no-benefit' ? '프라임 사용으로 늘어나는 이득이 없어 일반 재설정을 유지합니다.'
      : selectedFixedLabel ? <>고정 옵션: <b>{selectedFixedLabel}</b></>
      : '프라임 사용으로 늘어나는 이득이 없어 일반 재설정을 유지합니다.'}</p>
    {reason === 'non-selling' && selectedFixedLabel && <p>고정 옵션: <b>{selectedFixedLabel}</b></p>}
    {(!selectedFixedLabel || reason === 'no-benefit') && bestFixedLabel && <p>가장 유리한 고정 후보: {bestFixedLabel}</p>}
    {Number.isFinite(value) && <p>{objectiveLabel}: <b>{primeMeso(value)}</b>
      {Number.isFinite(improvement) && <> · 프라임 미사용 대비 <b>{improvement > 0 ? '+' : ''}{primeMeso(improvement)}</b></>}</p>}
  </div>;
}

export function PrimeCubeSettings({ prime, onChange, options, label = '프라임 큐브 모드 (레전드리 1줄 고정)',
  priceLabel = '프라임 큐브 가격 (억 메소 / 회)', description, optimization }) {
  return <CalculatorCard as="div" className={`calculator-prime-settings${prime.on ? ' calculator-prime-enabled' : ''}`}>
    <ToggleField on={prime.on} onChange={on => onChange({ ...prime, on, ...(on ? { fixedKey: 'auto' } : {}) })}
      label={label} color="#5ec8f2" />
    {prime.on && <>
      <label className="calculator-trade-field">{priceLabel}
        <NumericField label={priceLabel} value={prime.cost} scale={1e-8} unit="억 메소"
          onChange={cost => onChange({ ...prime, cost })} />
      </label>
      <label className="calculator-trade-field">고정할 1줄 옵션
        <select aria-label="고정할 1줄 옵션" value={prime.fixedKey} onChange={event => onChange({ ...prime, fixedKey: event.target.value })}>
          <option value="auto">자동 최적화</option>
          {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      {description && <p className="calculator-trade-help">{description}</p>}
      {prime.fixedKey === 'auto' && <p className="calculator-trade-help">현재 부위의 레전드리 첫 줄 옵션을 모두 비교합니다. 프라임 미사용보다 이득이 커지는 최적의 고정 옵션을 선택합니다.</p>}
      <PrimeOptimizationSummary optimization={optimization} automatic={prime.fixedKey === 'auto'} />
    </>}
  </CalculatorCard>;
}

export const CHARACTER_EFFICIENCY_FIELDS = Object.freeze([
  { key: 'mainFlat', label: '주스탯 +10', scale: 10 },
  { key: 'subFlat', label: '부스탯 +10', scale: 10 },
  { key: 'attackFlat', label: '유효 공격력·마력 +10', scale: 10 },
  { key: 'subPercent', label: '부스탯 +1%', scale: 1 },
  { key: 'allPercent', label: '올스탯 +1%', scale: 1 },
  { key: 'criticalDamagePercent', label: '크리티컬 데미지 +1%', scale: 1 },
  { key: 'criticalRatePercent', label: '크리티컬 확률 +1%', scale: 1 },
]);

/** Single-stat strategies and multi-stat trading share the same scoring inputs. */
export function CharacterEfficiencySettings({ settings, onChange, onMainStatChange, criticalDamageDisabled = false, children }) {
  return <div className="calculator-character-efficiency">
    <div className="calculator-section-title flame-section-title">
      <h2>캐릭터와 스탯 효율</h2>
      <button className="calculator-text-button flame-text-button" type="button"
        onClick={() => onChange({ efficiency: { ...DEFAULT_ADDITIONAL_EFFICIENCY } })}>효율 기본값</button>
    </div>
    <div className="calculator-character-fields">
      <label className="calculator-field">기준 캐릭터 레벨<NumericField label="기준 캐릭터 레벨" value={settings.characterLevel}
        min={1} max={300} step="1" unit="레벨" onChange={characterLevel => onChange({ characterLevel })} /></label>
      {onMainStatChange && <label className="calculator-field">주스탯<select aria-label="캐릭터 주스탯" value={settings.mainStat}
        onChange={event => onMainStatChange(event.target.value)}>{Object.keys(ADDITIONAL_SUBSTATS).map(stat => <option key={stat}>{stat}</option>)}</select></label>}
    </div>
    <div className="calculator-character-rules">
      <div><span>주스탯별 부스탯</span><b>{Object.entries(ADDITIONAL_SUBSTATS).map(([main, sub]) => `${main} → ${sub}`).join(' · ')}</b></div>
      <div><span>유효 공격력</span><b>STR·DEX·LUK: 공격력 · INT: 마력</b></div>
    </div>
    <p className="calculator-note">9레벨당 스탯 옵션은 캐릭터 레벨 ÷ 9의 정수 부분을 적용합니다. 기본 레벨 290은 32회분입니다.</p>
    <div className="calculator-efficiencies">{CHARACTER_EFFICIENCY_FIELDS.map(field => <label key={field.key}>
      <span>{field.label}</span><span className="calculator-equal" aria-hidden="true">=</span>
      <NumericField label={`${field.label}의 주스탯 환산 효율 (%)`} value={settings.efficiency[field.key]}
        scale={field.scale} unit="%" disabled={field.key === 'criticalDamagePercent' && criticalDamageDisabled}
        onChange={value => onChange({ efficiency: { ...settings.efficiency, [field.key]: value } })} />
    </label>)}</div>
    {criticalDamageDisabled && <p className="calculator-note">크리티컬 데미지는 가격 조건에서 별도로 입력하므로 스탯 환산에 합산하지 않습니다.</p>}
    <p className="calculator-note">환산값은 모두 주스탯 % 기준입니다. 부스탯과 유효 공격력은 주스탯에 맞춰 자동 적용하며, 드롭률·메소 획득량은 포함하지 않습니다.</p>
    {children}
  </div>;
}
