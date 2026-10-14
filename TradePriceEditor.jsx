import { useId } from 'react';
import { CalculatorCard } from './ui.jsx';
import './trade-price-editor.css';

/** Wide sales-price framing shared by trading calculators; each owns its pricing model. */
export function TradePriceEditor({ description, persistenceNote, actions, controls, gradeOptions = [],
  gradeValue, onGradeChange, gradeLabel = '판매가를 입력할 등급', gradeHelp, gradeActions, children, className = '' }) {
  const titleId = useId();
  return <CalculatorCard className={`trade-price-editor ${className}`.trim()} aria-labelledby={titleId}>
    <div className="trade-price-header">
      <div><h2 id={titleId}>판매가</h2><p className="trade-price-unit">억 메소 · 수수료 차감 전</p></div>
      {actions && <div className="trade-price-actions">{actions}</div>}
    </div>
    {description && <p className="trade-price-description">{description}</p>}
    {controls && <div className="trade-price-options">{controls}</div>}
    {!!gradeOptions.length && <div className="trade-price-grade-controls">
      <span className="trade-price-grade-label">{gradeLabel}</span>
      <div className="trade-price-grade-toolbar">
        <div className="trade-price-grade-buttons" role="group" aria-label={gradeLabel}>
          {gradeOptions.map(option => <button key={option.value} type="button" aria-pressed={gradeValue === option.value}
            style={{ '--trade-price-grade-color': option.color || 'var(--ui-accent)' }}
            onClick={() => onGradeChange(option.value)}>{option.label}</button>)}
        </div>
        {gradeActions && <div className="trade-price-actions">{gradeActions}</div>}
      </div>
      {gradeHelp && <p className="trade-price-help">{gradeHelp}</p>}
    </div>}
    <div className="trade-price-content">{children}</div>
    {persistenceNote && <p className="trade-price-help trade-price-persistence">{persistenceNote}</p>}
  </CalculatorCard>;
}
