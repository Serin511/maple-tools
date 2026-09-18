import { useEffect, useRef, useState } from 'react';
import { OPTIONS, OPTION_BY_ID, DEFAULT_SETTINGS, RESET_COSTS, costsFor, validateSettings, GRADES, qualifyingGrades } from './ability-data.mjs';
import './ability.css';
const SAVE_KEY='maple:ability:sets:v1';
const copy=x=>JSON.parse(JSON.stringify(x));
function loadSettings(){try{const s=JSON.parse(localStorage.getItem(SAVE_KEY));validateSettings(s);return s;}catch{return copy(DEFAULT_SETTINGS);}}
export const fmtMeso=n=>Number.isFinite(n)?(n/1e8).toLocaleString('ko-KR',{maximumFractionDigits:2})+'억':'—';
const num=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:1});
const pct=n=>(n*100).toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';
const rankedLabel=r=>r===1?'1순위만 달성':`${r}순위까지 타협`;
function AutoResetGuide({guide}) {
  if(!guide)return null;
  const complete=guide.covered&&guide.withinLimit;
  return <section className="ability-auto-reset" aria-label="자동 재설정 종료조건">
    <div className="ability-section-title"><h3>자동 재설정 종료조건</h3><span>{guide.rows.length} / {guide.maxEntries}개</span></div>
    {complete?<p className="ability-auto-toggle"><b>첫 줄 제외: {guide.ignoreFirst?'켜기':'끄기'}</b><span>{guide.ignoreFirst?'2·3번째 줄에서만 확인':'세 줄 모두에서 확인'}</span></p>:<p className="ability-auto-warning">이 목표에서는 아래 조건만으로 자동 재설정을 진행하지 마세요.{!guide.covered?' 유니크·레전드리 등록 조건으로 잡을 수 없는 채택 후보가 있습니다.':''}{!guide.withinLimit?' 필요한 조건이 6개를 넘어 한 번에 등록할 수 없습니다.':''} 타협 범위를 줄여 다시 계산하거나 직접 재설정 결과를 확인해 주세요.</p>}
    {guide.rows.length>0&&<div className="ability-table-scroll"><table><thead><tr><th>등록 옵션</th><th>등급</th><th>입력 수치</th></tr></thead><tbody>{guide.rows.map(row=><tr key={`${row.option}:${row.grade}`}><td>{row.label}</td><td>{GRADES[row.grade]}</td><td><b>{row.min}{row.unit==='%'?'%':` ${row.unit}`}</b> 이상</td></tr>)}</tbody></table></div>}
    {complete&&<p className="ability-muted">조건 중 하나만 맞아도 멈추도록 등록하세요. 옵션을 먼저 확보한 뒤 심연으로 수치를 올릴 수 있어, 입력 수치가 최종 목표보다 낮을 수 있습니다.</p>}
    {guide.rows.some(row=>row.lower)&&<p className="ability-muted">레벨당 공격력·마력은 옵션을 발견하기 위한 넓은 종료조건입니다. 멈춘 뒤 실제 레벨 간격이 목표 이하인지도 확인하세요.</p>}
    <p className="ability-auto-note">자동 재설정이 멈추면 세 줄을 ‘상황별 다음 행동’에 입력해 확인하세요. 새 결과의 남은 비용이 기존보다 작을 때만 채택하고, 크거나 같으면 기존 결과를 유지하세요.</p>
  </section>;
}
export default function AbilityPage(){
  const [settings,setSettings]=useState(loadSettings),[results,setResults]=useState([]),[selected,setSelected]=useState(1),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[detail,setDetail]=useState(null),[detailError,setDetailError]=useState(''),[variants,setVariants]=useState([]),[calculated,setCalculated]=useState('');
  const worker=useRef(null),request=useRef(0),detailRequest=useRef(0),settingsRef=useRef(settings);
  const result=results.find(r=>r.rank===selected),stale=calculated!==JSON.stringify(settings),costs=costsFor(settings);
  useEffect(()=>{settingsRef.current=settings;try{localStorage.setItem(SAVE_KEY,JSON.stringify(settings));}catch{}},[settings]);
  function makeWorker(){
    worker.current?.terminate();
    const source=document.getElementById('ability-worker-source');
    if(!source)throw new Error('계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    const url=URL.createObjectURL(new Blob([JSON.parse(source.textContent)],{type:'text/javascript'}));
    const w=new Worker(url);URL.revokeObjectURL(url);worker.current=w;
    w.onmessage=({data})=>{
      if(data.type==='detail'||(data.type==='error'&&data.requestType==='detail')) {
        if(data.id!==detailRequest.current)return;
        if(data.type==='error'){setDetail(null);setDetailError(data.message);}else{setDetail(data.detail);setVariants(data.detail.variants);setDetailError('');}
        return;
      }
      if(data.id!==request.current)return;
      if(data.type==='progress')setProgress(data.message);
      if(data.type==='result')setResults(prev=>[...prev,data.result]);
      if(data.type==='complete'){setBusy(false);setProgress('계산 완료');}
      if(data.type==='error'){setError(data.message);setBusy(false);setResults([]);}
    };
    w.onerror=()=>{setError('계산 엔진을 실행하지 못했습니다. 다시 계산해 주세요.');setBusy(false);setResults([]);};
    return w;
  }
  function calculate(s=settingsRef.current){
    try {
      validateSettings(s);const w=makeWorker();
      detailRequest.current++;setResults([]);setDetail(null);setError('');setDetailError('');setSelected(1);setBusy(true);setProgress('옵션 조합을 준비하고 있습니다…');setCalculated(JSON.stringify(s));
      w.postMessage({id:++request.current,type:'calculate',settings:s});
    }catch(e){setError(e.message);}
  }
  useEffect(()=>{calculate(settingsRef.current);return()=>worker.current?.terminate();},[]);
  function explore(stateId,chosen=undefined,rank=selected){
    setDetail(null);setDetailError('');
    worker.current?.postMessage({id:++detailRequest.current,type:'detail',rank,stateId,variants:chosen});
  }
  useEffect(()=>{if(result&&!stale){setVariants(result.initialVariants);explore(result.starts[0].id,undefined,result.rank);}},[result,stale]);
  function changeGoal(rank,index,patch){setSettings(prev=>({...prev,sets:prev.sets.map((s,r)=>r===rank?s.map((g,i)=>i===index?{...g,...patch}:g):s)}));}
  function addSet(){setSettings(prev=>{
    const next=copy(prev.sets.at(-1));
    if(prev.sets.length===1&&next.some(g=>g.option==='status')&&!next.some(g=>g.option==='attack'))next[next.findIndex(g=>g.option==='status')]={option:'attack',min:30};
    return {...prev,sets:[...prev.sets,next]};
  });}
  function selectRank(rank){setSelected(rank);setDetail(null);setDetailError('');detailRequest.current++;}
  return <main className="ability-page">
    <header className="ability-header"><div><div className="ability-eyebrow">ABILITY STRATEGY <span>레전드리 전용</span></div><h1>어빌리티 <em>최적 전략</em></h1><p>원하는 세 옵션까지, 가장 적은 기대 비용으로.<br className="mobile-break"/> 옵션 확보 순서와 심연의 서큘레이터 사용 시점을 함께 계산합니다.</p></div><div className="ability-source-badge"><span className="ability-dot"/> 2026.09.17 확률표 반영</div></header>
    <div className="ability-layout">
      <section className="ability-settings" aria-label="계산 설정">
        <div className="ability-card">
          <div className="ability-section-title"><h2>목표 옵션 세트</h2><span>{settings.sets.length} / 4</span></div>
          <p className="ability-muted">각 세트의 세 옵션을 모두 얻으면 달성입니다.<br/>옵션의 줄 순서는 자유롭게 계산합니다.<br/>유니크 스탑은 최소 등급과 목표 수치로 지정하세요.</p>
          {settings.sets.map((set,rank)=><fieldset className="ability-set" key={rank}><legend><span className="ability-rank">{rank+1}</span> {rank===0?'최우선 목표':'타협 가능한 세트'}</legend>{rank>0&&<button className="ability-remove" type="button" aria-label={`${rank+1}순위 세트 삭제`} onClick={()=>setSettings(prev=>({...prev,sets:prev.sets.filter((_,i)=>i!==rank)}))}>삭제</button>}
            {set.map((g,index)=>{const option=OPTION_BY_ID[g.option];return <div className="ability-goal" key={index}>
              <label><span className="ability-sr">{rank+1}순위 옵션 {index+1}</span><select aria-label={`${rank+1}순위 옵션 ${index+1}`} value={g.option} onChange={e=>{
                const o=OPTION_BY_ID[e.target.value],min=o.lower?Math.min(...o.values[2]):Math.max(...o.values[2]);changeGoal(rank,index,{option:o.id,min,secondaryMin:0});
              }}>{OPTIONS.map(o=><option key={o.id} value={o.id}>{o.label}{o.unit==='%'?' (%)':''}</option>)}</select></label>
              <label className="ability-grade"><span>최소 등급</span><select aria-label={`${rank+1}순위 옵션 ${index+1} 최소 등급`} value={g.minGrade??0} onChange={e=>changeGoal(rank,index,{minGrade:Number(e.target.value)})}><option value={0}>등급 무관 · 수치로 판정</option><option value={1}>유니크 이상</option><option value={2}>레전드리</option></select></label>
              <div className="ability-cutoff"><span>{option.lower?'레벨 간격':'목표 최소치'}</span><label><input aria-label={`${rank+1}순위 옵션 ${index+1} 목표 수치`} type="number" min="0" step="any" value={g.min} onChange={e=>changeGoal(rank,index,{min:e.target.value===''?'':Number(e.target.value)})}/><span>{option.unit} {option.lower?'이하':'이상'}</span></label></div>
              <p className="ability-grade-hint">{qualifyingGrades(g).length?`수치 충족 시 ${qualifyingGrades(g).map(t=>GRADES[t]).join('·')}에서 종료 가능`:'선택한 조건을 만족하는 수치가 없습니다.'}</p>
              {option.secondary&&<div className="ability-cutoff"><span>두 번째 스탯 최소치</span><label><input aria-label={`${rank+1}순위 옵션 ${index+1} 두 번째 스탯 최소치`} type="number" min="0" value={g.secondaryMin??0} onChange={e=>changeGoal(rank,index,{secondaryMin:e.target.value===''?'':Number(e.target.value)})}/><span>이상</span></label></div>}
            </div>;})}
          </fieldset>)}
          {settings.sets.length<4&&<button className="ability-add" type="button" onClick={addSet}>＋ {settings.sets.length+1}순위 타협 세트 추가</button>}
        </div>
        <div className="ability-card"><h2>재화 시세</h2>
          <label className="ability-price-label">대형 보스 명예의 훈장 1개 가격<div className="ability-input-unit"><input aria-label="훈장 1개 가격 (만 메소)" type="number" min="0" step="any" value={settings.medalPrice===''?'':settings.medalPrice/1e4} onChange={e=>setSettings(prev=>({...prev,medalPrice:e.target.value===''?'':Number(e.target.value)*1e4}))}/><span>만 메소</span></div><small>1개 = 명성치 5,000 · 기본 600만 메소</small></label>
          <label className="ability-price-label">메소마켓 · 1억 메소 가격<div className="ability-input-unit"><input aria-label="1억 메소당 메이플포인트" type="number" min="1" step="any" value={settings.marketRate} onChange={e=>setSettings(prev=>({...prev,marketRate:e.target.value===''?'':Number(e.target.value)}))}/><span>메이플포인트</span></div></label>
          <div className="ability-exchange"><span>심연의 서큘레이터 1개</span><b>{fmtMeso(costs.circulator)} 메소</b><small>4,900 메이플포인트 ÷ 시세 × 1억</small></div>
          <details className="ability-details"><summary>고정 개수별 1회 비용</summary><div className="ability-cost-list">{RESET_COSTS.map((c,i)=><div key={i}><b>{i}개 고정</b><span>명성치 {num(c.honor)} + {num(c.meso/1e4)}만 메소<br/><strong>환산 {fmtMeso(costs.resets[i])} 메소</strong></span></div>)}</div></details>
        </div>
        <button className="ability-calculate" type="button" onClick={()=>calculate()}>{busy?'현재 설정으로 다시 계산':'최적 전략 계산'} <span>→</span></button>
        <div className="ability-status" role="status" aria-live="polite">{busy?progress:stale&&results.length?'설정이 바뀌었습니다. 다시 계산해 주세요.':progress}</div>
        {error&&<div className="ability-error" role="alert">{error}</div>}
      </section>
      <section className="ability-results" aria-label="전략 계산 결과">
        {(!result||stale)&&<div className="ability-card ability-empty"><div className="ability-empty-icon">✦</div><h2>{stale&&results.length?'새 목표로 전략을 계산해 주세요':'모든 선택지를 비교하고 있습니다'}</h2><p>세트별 최소 수치와 재화 시세를 입력하면<br/>목표까지의 예상 비용과 다음 행동을 확인할 수 있습니다.</p>{busy&&<div className="ability-progress"/>}</div>}
        {result&&!stale&&<>
          <div className="ability-comparisons" aria-label="타협 범위 비교">{results.map(r=><button type="button" key={r.rank} className={selected===r.rank?'selected':''} aria-pressed={selected===r.rank} onClick={()=>selectRank(r.rank)}><span>{rankedLabel(r.rank)}</span><strong>{fmtMeso(r.total)}</strong><small>{r.rank===1?'메소 환산 기대 비용':`1순위만 대비 ${pct(1-r.total/results[0].total)} 절감`}</small></button>)}</div>
          <div className="ability-card ability-total"><div className="ability-section-title"><span className="ability-pill">{rankedLabel(selected)}</span><span>처음부터 시작 · 기대 비용</span></div><div className="ability-total-number">{fmtMeso(result.total)} <small>메소</small></div><p>명성치 구매비 + 재설정 메소 + 서큘레이터 환산 비용</p><div className="ability-strategy-comparison"><div><span>고급 재설정만 사용</span><b>{fmtMeso(result.noCircle)}</b></div><div><span>옵션을 다 모은 뒤에만 서큘레이터</span><b>{fmtMeso(result.finishOnly)}</b></div><div><span>사용 시점까지 최적화</span><b className="ability-green">{fmtMeso(result.total)}</b></div></div><p className="ability-model-note">동일 결과 재추첨을 제외한 모델의 최적값입니다. 재추첨을 반영한 기대 비용의 계산 범위는 <b>{fmtMeso(result.lowerTotal)}~{fmtMeso(result.total)}</b> 메소입니다.</p></div>
          <div className="ability-card"><div className="ability-section-title"><h2>예상 소모 재화</h2><span>평균값 · 소모량 보장 아님</span></div><div className="ability-resource-grid"><div><span>고급 재설정</span><strong>{num(result.counts.slice(0,3).reduce((s,n)=>s+n,0))}<small> 회</small></strong></div><div><span>명성치</span><strong>{num(result.counts.slice(0,3).reduce((s,n,i)=>s+n*RESET_COSTS[i].honor,0)/1e4)}<small> 만</small></strong></div><div><span>심연의 서큘레이터</span><strong>{num(result.counts[3])}<small> 개</small></strong></div></div><div className="ability-cost-bars">{result.counts.map((n,i)=>{const cost=n*(i===3?costs.circulator:costs.resets[i]);return <div key={i}><span>{i===3?'심연의 서큘레이터':`${i}개 고정 재설정`}</span><div><i style={{width:`${cost/result.total*100}%`,background:i===3?'#b093fa':undefined}}/></div><b>{fmtMeso(cost)}</b></div>;})}</div></div>
          <div className="ability-card"><h2>옵션 확보와 서큘레이터 사용</h2><p className="ability-muted">매번 나온 결과에 따라 최적 순서가 달라집니다. 목표 옵션의 종류·등급이 맞으면 수치가 낮아도 먼저 확보할 수 있습니다.</p><div className="ability-first-options"><h3>처음 채택할 때 확보하는 후보</h3><div className="ability-table-scroll"><table><thead><tr><th>옵션</th><th>1줄에서</th><th>2·3줄에서</th></tr></thead><tbody>{result.firstOptions.map(o=><tr key={o.option}><td>{OPTION_BY_ID[o.option].label}</td><td>{pct(o.lines[0])}</td><td>{pct(o.lines[1]+o.lines[2])}</td></tr>)}</tbody></table></div><small>첫 채택 결과에서 종류·등급이 맞는 후보를 얻는 비율입니다. 동시 획득을 포함해 합이 100%를 넘을 수 있습니다.</small></div><div className="ability-timing"><span className="ability-step">01</span><div><h3>고정 없이 시작</h3><p>한 번의 재설정에서 채택할 만한 결과가 나올 확률은 {pct(result.acceptedP)}입니다. 아래 상황별 판단에서 고정할 줄을 확인하세요.</p><details className="ability-details"><summary>시작할 때 자동 재설정 등록 조건</summary><AutoResetGuide guide={result.autoReset}/></details></div></div><div className="ability-timing"><span className="ability-step purple">02</span><div><h3>서큘레이터 전환도 결과에 맞춰 결정</h3><p>최적 정책에서 서큘레이터를 한 번 이상 사용할 확률은 {pct(result.circleUseProbability)}입니다.</p><div className="ability-stage-chips">{[1,2,3].map(n=><span key={n}>목표 후보 {n}개 확보 시 첫 사용 <b>{pct(result.circleStages[n])}</b></span>)}</div><small>전체 시작 횟수 대비 비율입니다. 후보는 허용 세트에 쓰일 수 있는 종류·등급이며, 최종 수치 달성과는 다릅니다. 비용이 같은 전략 중 한 가지를 표시합니다.</small></div></div>
            {selected>1&&<div className="ability-finish-ranks"><h3>어떤 세트에서 끝날까요?</h3>{result.finishRanks.slice(0,selected).map((p,i)=><div key={i}><span>{i+1}순위 세트</span><b>{pct(p)}</b></div>)}<small>여러 세트를 동시에 만족하면 가장 높은 순위로 집계합니다.</small></div>}
          </div>
          <div className="ability-card ability-explorer"><div className="ability-section-title"><h2>상황별 다음 행동</h2><span>실제 줄 순서로 선택</span></div><p className="ability-muted">현재 상태 또는 재설정 결과를 선택하세요. 표시된 수치 중 하나이면 같은 상태로 계산됩니다.</p>
            <div className="ability-state-selects">{result.variantLabels.map((list,i)=><label key={i}><span>{i+1}줄</span><select aria-label={`현재 ${i+1}줄 상태`} value={variants[i]??''} onChange={e=>{const next=[...variants];next[i]=Number(e.target.value);setVariants(next);explore(undefined,next);}}>{list.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>)}</div>
            {detailError&&<p className="ability-error" role="alert">{detailError}</p>}
            {detail&&<><div className="ability-next-action"><span>추천 행동</span><h3>{detail.action}</h3>{detail.actionKind==='circle'&&<p>목표까지 심연의 서큘레이터 <strong>평균 {num(detail.stats[3])}개</strong></p>}<p>이 상태에서 목표까지 <strong>{fmtMeso(detail.remaining)} 메소</strong></p></div><AutoResetGuide guide={detail.autoReset}/>{detail.choices.length>0&&<><p className="ability-muted">새 결과의 ‘목표까지 남은 비용’이 현재보다 작으면 채택하고, 크면 기존 결과를 유지하세요. 세 줄 전체를 한 번에 선택합니다.</p><details className="ability-details"><summary>모든 고정 조합·서큘레이터 비교</summary><div className="ability-table-scroll"><table><thead><tr><th>이번 행동</th><th>최적 행동 대비 추가 기대 비용</th><th>결과 채택 확률</th></tr></thead><tbody>{detail.choices.map(c=><tr key={c.id}><td>{c.action}</td><td>{c.extra<1?'동률 최적':fmtMeso(c.extra)}</td><td>{pct(c.acceptProbability)}</td></tr>)}</tbody></table></div><small>이번 행동을 한 번 수행한 뒤 최적 전략을 따르는 경우의 비교입니다.</small></details>
              <details className="ability-details"><summary>추천 행동 후 채택할 결과 예시</summary><div className="ability-examples">{detail.next.map(n=><button type="button" key={n.id} onClick={()=>explore(n.id)}><span>{n.lines.map((l,i)=><small key={i}>{l}</small>)}</span><strong>{n.action} →</strong><small>1회당 {pct(n.p)} · 남은 비용 {fmtMeso(n.remaining)}</small></button>)}</div><small>확률이 큰 일부 결과만 표시합니다. 모든 결과는 위 선택기로 조회할 수 있습니다.</small></details></>}</>}
          </div>
          <details className="ability-card ability-assumptions"><summary>계산 기준과 확률 출처</summary><ul><li>레전드리 어빌리티에서 유효 옵션을 확보하지 않은 상태로 시작합니다. 첫 번째 유료 고급 재설정부터 비용을 계산합니다.</li><li>1줄은 레전드리 100%, 2·3줄은 레전드리 2%·유니크 15%·에픽 83%입니다. 옵션 중복 제외 후 등급별 확률을 다시 계산합니다.</li><li>모든 줄 배치, 동시 획득, 0·1·2줄 고정, 기존 고정 해제, 비목표 옵션 임시 고정, 이전 결과 유지, 서큘레이터 사용 후 다시 고급 재설정하는 경로를 비교합니다.</li><li>심연은 옵션 종류와 등급을 유지하며 세 줄의 수치를 동시에 재설정합니다. 줄별 수치 선택은 할 수 없으며 기존 세 줄 또는 새 세 줄을 선택합니다.</li><li>각 옵션은 선택한 최소 등급 이상이면서 목표 수치를 만족하면 달성입니다. 등급 무관은 수치만으로 판정하며, 유니크 스탑에서도 더 높은 등급의 목표 충족 옵션은 인정합니다. 허용 순위 내 세트는 모두 종료 조건입니다. 상위 세트에 추가 가치를 임의로 부여하지 않고, 허용 세트 중 하나까지의 기대 비용을 최소화합니다.</li><li>반올림 표기 확률의 합을 100%로 정규화합니다. 고급 재설정의 완전 동일 결과 재추첨은 현재의 비목표 수치에 따라 달라져 대표 모델에서 제외하고, 그 효과를 포함하는 비용 하한·상한을 함께 표시합니다. 범위 안에서 세부 최적 행동이 달라질 수 있습니다.</li><li>명성치는 훈장 가격으로 전량 환산합니다. 메소마켓 수수료·구매 제한·이벤트 할인·이미 보유한 명성치는 반영하지 않습니다. 표의 수량은 대표 모델의 기댓값입니다.</li><li>이번 계산: {num(result.states)}개 상태 · {num(result.actions)}개 행동 분포. 확률을 열거하고 결과 채택의 최적 정지 방정식을 풉니다.</li></ul><div className="ability-source-links"><a href="https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue" target="_blank" rel="noreferrer">공식 어빌리티 확률표 ↗</a><a href="https://maplestory.nexon.com/Guide/N23GameInformation/Articles/392" target="_blank" rel="noreferrer">공식 어빌리티 가이드 ↗</a></div></details>
        </>}
      </section>
    </div>
    <footer className="ability-footer">메이플 계산기 · 입력값은 이 브라우저에 자동 저장됩니다.</footer>
  </main>;
}
