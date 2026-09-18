import { OPTIONS, OPTION_BY_ID, GRADE_PROBABILITIES, VALUE_PROBABILITIES, GRADES, costsFor, validateSettings, goalMatchesValue } from './ability-data.mjs';

// The observable model retains option identity (or exchangeable non-target
// identities), grade whenever it affects the goal, and cutoff satisfaction.
// Non-targets are NOT discarded: temporarily locking them may improve odds.
// Identical-result rejection is bounded separately; see docs/ability-model.md.
export function buildModel(settings, maxRank = 1) {
  validateSettings(settings);
  const sets = settings.sets.slice(0,maxRank);
  const goals = sets.flat().map((g,i)=>({...g,bit:1<<i}));
  const targetIds = new Set(goals.map(g=>g.option));
  const setMasks = sets.map((_,i)=>7<<(i*3));
  const types=[], grouped=new Map();
  for (const option of OPTIONS) {
    const key=targetIds.has(option.id)?option.id:option.weights.join(',');
    if(!grouped.has(key)) {
      grouped.set(key,types.length);
      types.push({id:types.length,weights:option.weights,count:0,members:[],target:targetIds.has(option.id)});
    }
    const t=types[grouped.get(key)]; t.count++;t.members.push(option.id);
  }
  const totals=[0,1,2].map(g=>OPTIONS.reduce((s,o)=>s+o.weights[g],0));
  const variants=[[],[],[]], byType=[[],[],[]];
  for(let line=0;line<3;line++) for(const type of types) {
    const list=[];byType[line][type.id]=list;
    let irrelevantProbability=0;
    for(let grade=0;grade<3;grade++) {
      const pg=GRADE_PROBABILITIES[line][grade]; if(!pg||!type.weights[grade]) continue;
      const o=OPTION_BY_ID[type.members[0]], conditions=goals.filter(g=>g.option===o.id);
      const buckets=new Map();
      (o.values[grade]||[]).forEach((v,i)=> {
        const mask=conditions.reduce((m,g)=>m|(goalMatchesValue(g,grade,v,o.secondary?.[grade]?.[i])?g.bit:0),0);
        if(!buckets.has(mask))buckets.set(mask,{p:0,values:[]});
        const b=buckets.get(mask);b.p+=VALUE_PROBABILITIES[i];b.values.push(v);
      });
      if([...buckets.keys()].every(m=>m===0)){irrelevantProbability+=pg*type.weights[grade];continue;}
      for(const [mask,bucket]of buckets) {
        const v={id:variants[line].length,type:type.id,grade,mask,met:mask!==0,pValue:bucket.p,eligible:true,values:[...new Set(bucket.values)]};
        variants[line].push(v);list.push(v);
      }
    }
    if(irrelevantProbability>0) {
      const v={id:variants[line].length,type:type.id,grade:-1,mask:0,pValue:1,met:false,eligible:false};
      variants[line].push(v);list.push(v);
    }
  }
  // Grade-marginalized weights cannot be used before duplicate exclusion:
  // different grades have different denominators. Keep the exact mixture.
  function variantProbability(line,v,used) {
    const t=types[v.type],left=t.count-(used.get(t.id)||0);if(left<=0)return 0;
    let p=0;
    for(let g=0;g<3;g++) {
      if(!GRADE_PROBABILITIES[line][g]||!t.weights[g])continue;
      if(v.grade!==-1&&v.grade!==g)continue;
      if(v.grade===-1 && byType[line][t.id].some(x=>x.grade===g))continue;
      let denominator=totals[g];for(const [id,n] of used)denominator-=n*types[id].weights[g];
      const valueP=v.pValue;
      p+=GRADE_PROBABILITIES[line][g]*left*t.weights[g]/denominator*valueP;
    }
    return p;
  }
  const states=[],index=new Map(),sizes=variants.map(a=>a.length);
  const key=(a,b,c)=>(a*sizes[1]+b)*sizes[2]+c;
  for(const a of variants[0])for(const b of variants[1])for(const c of variants[2]) {
    const counts=new Map();for(const v of [a,b,c])counts.set(v.type,(counts.get(v.type)||0)+1);
    if([...counts].some(([t,n])=>n>types[t].count))continue;
    const achievedMask=a.mask|b.mask|c.mask;
    const goalRank=setMasks.findIndex(m=>(achievedMask&m)===m);
    const state={id:states.length,v:[a,b,c],goal:goalRank!==-1,goalRank,actions:[],incoming:[]};
    index.set(key(a.id,b.id,c.id),state.id);states.push(state);
  }
  if(!states.some(s=>s.goal)) throw new Error(`${maxRank}순위까지의 목표 조합은 불가능합니다. 목표 옵션과 최소 수치를 확인해 주세요.`);
  const costs=costsFor(settings),actions=[],actionIndex=new Map();
  function getAction(k,kind,mask,fixed) {
    if(actionIndex.has(k)) return actionIndex.get(k);
    const id=actions.length, locks=fixed.filter(Boolean).length;
    actions.push({id,kind,mask,fixed,cost:kind==='circle'?costs.circulator:costs.resets[locks],sources:[],outcomes:[],rejectionBound:0});
    actionIndex.set(k,id);return id;
  }
  for(const s of states) {
    for(let mask=0;mask<7;mask++) {
      const fixed=s.v.map((v,i)=>mask&(1<<i)?v:null);
      const id=getAction(`r:${mask}:${fixed.map(v=>v?.id??'-').join(',')}`,'reset',mask,fixed);
      s.actions.push(id);actions[id].sources.push(s.id);
    }
    if(s.v.some((v,i)=>byType[i][v.type].filter(x=>x.grade===v.grade).length>1)) {
      const id=getAction(`c:${s.v.map(v=>`${v.type}/${v.grade}`).join(',')}`,'circle',7,s.v);
      s.actions.push(id);actions[id].sources.push(s.id);
    }
  }
  let edgeCount=0;
  for(const action of actions) {
    const used=new Map(),result=[null,null,null];
    if(action.kind==='reset') action.fixed.forEach((v,i)=>{if(v){used.set(v.type,(used.get(v.type)||0)+1);result[i]=v;}});
    function visit(line,p) {
      if(line===3) {
        const id=index.get(key(...result.map(v=>v.id)));
        if(id===undefined)throw new Error('Invalid transition state');
        action.outcomes.push([id,p]);states[id].incoming.push([action.id,p]);edgeCount++;return;
      }
      if(action.kind==='reset'&&action.fixed[line]) {visit(line+1,p);return;}
      if(action.kind==='circle') {
        const original=action.fixed[line];
        for(const v of byType[line][original.type]) if(v.grade===original.grade) {
          const q=v.pValue;result[line]=v;visit(line+1,p*q);
        }
        return;
      }
      for(const v of variants[line]) {
        const q=variantProbability(line,v,used);if(q<=0)continue;
        used.set(v.type,(used.get(v.type)||0)+1);result[line]=v;
        visit(line+1,p*q);
        const n=used.get(v.type)-1;if(n)used.set(v.type,n);else used.delete(v.type);
      }
    }
    visit(0,1);
    const sum=action.outcomes.reduce((s,[,p])=>s+p,0);
    if(Math.abs(sum-1)>1e-9)throw new Error(`Transition mass ${sum}`);
    // Certified upper bound on the probability of one exact old triple.
    // At most two option identities are excluded from any grade pool.
    if(action.kind==='reset') {
      let bound=1;
      for(let line=0;line<3;line++) if(!action.fixed[line]) {
        let best=0;
        for(const o of OPTIONS) for(let g=0;g<3;g++) {
          if(!o.weights[g]||!GRADE_PROBABILITIES[line][g])continue;
          const excluded=OPTIONS.filter(x=>x.id!==o.id).map(x=>x.weights[g]).sort((a,b)=>b-a).slice(0,2).reduce((s,w)=>s+w,0);
          const masses=new Map();o.values[g]?.forEach((v,i)=>masses.set(v,(masses.get(v)||0)+VALUE_PROBABILITIES[i]));
          const maxValue=Math.max(...masses.values());
          best=Math.max(best,GRADE_PROBABILITIES[line][g]*o.weights[g]/(totals[g]-excluded)*maxValue);
        }
        bound*=best;
      }
      action.rejectionBound=bound;
    }
  }
  return {settings,sets,goals,maxRank,types,variants,states,actions,costs,edgeCount,index,key,initialAction:actionIndex.get('r:0:-,-,-')};
}

export const improves = (candidate, current) => candidate < current - Math.max(1e-5, Math.abs(current)*1e-12);

class Heap {
  a=[];
  push(x) {const a=this.a;let i=a.length;a.push(x);while(i){const p=(i-1)>>1;if(a[p][0]<=x[0])break;a[i]=a[p];i=p;}a[i]=x;}
  pop(){const a=this.a,r=a[0],x=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=x[0])break;a[i]=a[j];i=j;}a[i]=x;}return r;}
}

// Stochastic Dijkstra for selectable whole-result rerolls. An action with
// settled successor values has offer (cost + sum(p*V)) / sum(p).
// Its first final offer precedes every not-yet-settled successor, so rejecting
// those successors is optimal. Positive costs make the accepted policy acyclic.
export function solveModel(model, {allowCircle=true, lowerBound=false, finishOnly=false}={}) {
  const {states,actions}=model,n=states.length;
  const value=new Float64Array(n).fill(Infinity),policy=new Int32Array(n).fill(-1),settled=new Uint8Array(n);
  const offers=new Float64Array(actions.length).fill(Infinity),mass=new Float64Array(actions.length),weighted=new Float64Array(actions.length),done=new Uint8Array(actions.length);
  const stats=Array.from({length:n},()=>null),heap=new Heap(),order=[];
  const active=actions.map(a=>(allowCircle||a.kind!=='circle')&&(!finishOnly||a.kind!=='circle'||a.outcomes.some(([id])=>states[id].goal)));
  states.forEach(s=>{if(s.goal){value[s.id]=0;heap.push([0,0,s.id]);}});
  while(heap.a.length) {
    const [v,kind,id]=heap.pop();
    if(kind===0) {
      if(settled[id]||v!==value[id])continue;
      settled[id]=1;order.push(id);
      const aId=policy[id];
      if(aId<0)stats[id]=[0,0,0,0];
      else {
        const a=actions[aId],s=[0,0,0,0];let p=0;
        for(const [t,q]of a.outcomes)if(improves(value[t],v)&&settled[t]) {p+=q;for(let j=0;j<4;j++)s[j]+=q*stats[t][j];}
        s[a.kind==='circle'?3:a.fixed.filter(Boolean).length]++;
        stats[id]=s.map(x=>x/p);
      }
      for(const [a,p]of states[id].incoming) {
        if(done[a]||!active[a])continue;
        mass[a]+=p;weighted[a]+=p*v;
        const c=actions[a].cost*(lowerBound?1-actions[a].rejectionBound:1);
        offers[a]=(c+weighted[a])/mass[a];heap.push([offers[a],1,a]);
      }
    } else {
      if(done[id]||v!==offers[id])continue;
      done[id]=1;
      for(const s of actions[id].sources)if(!settled[s]&&v<value[s]){value[s]=v;policy[s]=id;heap.push([v,0,s]);}
    }
  }
  const a=actions[model.initialAction];
  const initial=offers[a.id];
  if(!Number.isFinite(initial))throw new Error('달성 가능한 전략을 찾지 못했습니다.');
  let acceptMass=0;const initialStats=[0,0,0,0];
  for(const [id,p] of a.outcomes)if(improves(value[id],initial)) {acceptMass+=p;stats[id].forEach((v,j)=>initialStats[j]+=p*v);}
  initialStats[0]++;for(let j=0;j<4;j++)initialStats[j]/=acceptMass;
  return {value,policy,stats,initial,initialStats,offers,order,active};
}

export function stateLabel(model,id) {
  return model.states[id].v.map((v,line)=>{
    const t=model.types[v.type],o=OPTION_BY_ID[t.members[0]];
    if(!v.eligible)return `${line+1}줄: ${t.target?o.label:`기타 · ${t.members.map(id=>OPTION_BY_ID[id].label).join(' / ')}`} · 목표 미해당`;
    return `${line+1}줄: ${GRADES[v.grade]} ${o.label} ${v.values.join('/')} ${o.unit}${v.met?'':' · 수치 미달'}`;
  });
}
export function actionLabel(action) {
  if(action.kind==='circle')return '심연의 서큘레이터 사용';
  const lines=action.fixed.flatMap((v,i)=>v?[i+1]:[]);
  return lines.length?`${lines.map(n=>`${n}번째 줄`).join(' · ')} 고정 후 고급 재설정`:'고정 없이 고급 재설정';
}

// Auto reset stops on an OR of individual options, while the optimal policy
// accepts whole triples. Find a cover of ALL beneficial outcomes, never just
// the most frequent examples. Stopping is a prompt to inspect, not to accept.
export function autoResetGuide(model,solution,remaining=solution.initial) {
  const outcomes=model.actions[model.initialAction].outcomes;
  const accepted=outcomes.filter(([id])=>improves(solution.value[id],remaining));
  const acceptedProbability=accepted.reduce((sum,[,p])=>sum+p,0);
  const countBits=n=>{let count=0;while(n){n&=n-1;count++;}return count;};
  const modes=[false,true].map(ignoreFirst=>{
    const byKey=new Map();
    for(const [id]of accepted)model.states[id].v.forEach((v,line)=>{
      if((ignoreFirst&&line===0)||!v.eligible||v.grade<1)return;
      const option=model.types[v.type].members[0],key=`${option}:${v.grade}`;
      if(!byKey.has(key))byKey.set(key,{option,grade:v.grade,min:Infinity});
      byKey.get(key).min=Math.min(byKey.get(key).min,...v.values);
    });
    const candidates=[...byKey.values()];
    const candidateIndex=new Map(candidates.map((r,i)=>[`${r.option}:${r.grade}`,i]));
    const maskForState=id=>{
      let mask=0;
      model.states[id].v.forEach((v,line)=>{
        if((ignoreFirst&&line===0)||v.grade<1)return;
        const i=candidateIndex.get(`${model.types[v.type].members[0]}:${v.grade}`);
        if(i!==undefined&&v.values.some(value=>value>=candidates[i].min))mask|=1<<i;
      });
      return mask;
    };
    const patterns=new Set();let missingProbability=0;
    for(const [id,p]of accepted){const mask=maskForState(id);if(mask)patterns.add(mask);else missingProbability+=p;}
    // A triple has at most three candidates. Branching on one uncovered
    // pattern gives at most 3^6 branches for the game's six-entry limit.
    const required=[...patterns].sort((a,b)=>countBits(a)-countBits(b)).filter((mask,i,all)=>!all.slice(0,i).some(smaller=>(mask&smaller)===smaller));
    const distribution=new Map();
    for(const [id,p]of outcomes){const mask=maskForState(id);if(mask)distribution.set(mask,(distribution.get(mask)||0)+p);}
    const stopProbability=selected=>{let p=0;for(const [mask,q]of distribution)if(mask&selected)p+=q;return p;};
    let best=null,bestCount=7,bestStop=Infinity;
    const seen=new Set();
    const search=selected=>{
      if(seen.has(selected))return;seen.add(selected);
      const count=countBits(selected);if(count>6||count>bestCount)return;
      const uncovered=required.find(mask=>!(mask&selected));
      if(uncovered===undefined){const p=stopProbability(selected);if(count<bestCount||(count===bestCount&&p<bestStop)){best=selected;bestCount=count;bestStop=p;}return;}
      if(count===6||count===bestCount)return;
      for(let bits=uncovered;bits;bits&=bits-1)search(selected|(bits&-bits));
    };
    search(0);
    const selected=best??((1<<candidates.length)-1);
    const rows=candidates.filter((_,i)=>selected&(1<<i)).map(r=>({...r,label:OPTION_BY_ID[r.option].label,unit:OPTION_BY_ID[r.option].unit,lower:OPTION_BY_ID[r.option].lower}));
    return {ignoreFirst,rows,maxEntries:6,covered:missingProbability===0&&accepted.length>0,withinLimit:best!==null,
      missingProbability,acceptedProbability,stopProbability:stopProbability(selected)};
  });
  // Prefer a complete, registerable cover; then fewer rows and fewer stops.
  modes.sort((a,b)=>Number(b.covered&&b.withinLimit)-Number(a.covered&&a.withinLimit)
    ||a.missingProbability-b.missingProbability||a.rows.length-b.rows.length||a.stopProbability-b.stopProbability);
  return modes[0];
}
export function describeState(model,solution,id) {
  const s=model.states[id],v=solution.value[id];
  if(s.goal)return {id,lines:stateLabel(model,id),remaining:0,action:'목표 달성 · 종료',choices:[],next:[]};
  const choices=s.actions.filter(a=>solution.active[a]).map(a=>{
    const action=model.actions[a];let p=0,pv=0;
    for(const [t,q] of action.outcomes)if(improves(solution.value[t],v)) {p+=q;pv+=q*solution.value[t];}
    // One attempt, followed by the optimal policy (including rejection).
    const attempt=action.cost+pv+(1-p)*v;
    return {action:actionLabel(action),id:a,cost:attempt,extra:Math.max(0,attempt-v),acceptProbability:p};
  }).sort((a,b)=>a.cost-b.cost);
  const action=model.actions[solution.policy[id]],next=action.outcomes.filter(([t])=>improves(solution.value[t],v)).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([t,p])=>({id:t,p,lines:stateLabel(model,t),remaining:solution.value[t],action:model.states[t].goal?'목표 달성 · 종료':actionLabel(model.actions[solution.policy[t]])}));
  return {id,lines:stateLabel(model,id),remaining:v,action:actionLabel(action),actionKind:action.kind,choices,next,stats:solution.stats[id],
    autoReset:action.kind==='reset'&&action.mask===0?autoResetGuide(model,solution,v):null};
}
export function summarize(model,solution,lower,noCircle,finishOnly) {
  const action=model.actions[model.initialAction];
  const accepted=action.outcomes.filter(([id])=>improves(solution.value[id],solution.initial));
  const acceptedP=accepted.reduce((s,[,p])=>s+p,0);
  const starts=accepted.sort((a,b)=>b[1]-a[1]).slice(0,12).map(([id,p])=>({...describeState(model,solution,id),p,conditionalProbability:p/acceptedP}));
  // Occupancy probabilities along strictly decreasing remaining-cost states.
  const reach=new Float64Array(model.states.length),firstCircle=new Float64Array(model.states.length);
  for(const [id,p]of accepted){reach[id]+=p/acceptedP;firstCircle[id]+=p/acceptedP;}
  const circleStages=[0,0,0,0],firstKept=[0,0,0],finishRanks=[0,0,0,0],firstOptions=new Map();
  for(const [id,p]of accepted)model.states[id].v.forEach((v,i)=>{if(v.eligible){firstKept[i]+=p/acceptedP;const option=model.types[v.type].members[0];if(!firstOptions.has(option))firstOptions.set(option,[0,0,0]);firstOptions.get(option)[i]+=p/acceptedP;}});
  for(const id of [...solution.order].reverse()) {
    const s=model.states[id];if(s.goal){finishRanks[s.goalRank]+=reach[id];continue;}
    const a=model.actions[solution.policy[id]],v=solution.value[id];
    const outcomes=a.outcomes.filter(([t])=>improves(solution.value[t],v)),mass=outcomes.reduce((s,[,p])=>s+p,0);
    if(a.kind==='circle')circleStages[s.v.filter(v=>v.eligible).length]+=firstCircle[id];
    for(const [t,p]of outcomes) {reach[t]+=reach[id]*p/mass;if(a.kind!=='circle')firstCircle[t]+=firstCircle[id]*p/mass;}
  }
  return {rank:model.maxRank,total:solution.initial,lowerTotal:lower.initial,noCircle:noCircle.initial,finishOnly:finishOnly.initial,
    counts:solution.initialStats,states:model.states.length,actions:model.actions.length,edges:model.edgeCount,starts,acceptedP,circleStages,firstKept,finishRanks,firstOptions:[...firstOptions].map(([option,lines])=>({option,lines,total:lines.reduce((s,p)=>s+p,0)})).sort((a,b)=>b.total-a.total),
    autoReset:autoResetGuide(model,solution),circleUseProbability:circleStages.reduce((s,p)=>s+p,0),maxRejectionBound:model.actions.reduce((m,a)=>Math.max(m,a.rejectionBound),0)};
}
