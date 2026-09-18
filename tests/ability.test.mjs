import test from 'node:test';
import assert from 'node:assert/strict';
import { OPTIONS, OPTION_BY_ID, DEFAULT_SETTINGS, VALUE_PROBABILITIES, GRADE_PROBABILITIES, passProbability, costsFor, validateSettings, goalMatchesValue, qualifyingGrades } from '../ability-data.mjs';
import { buildModel, solveModel, summarize, improves, describeState, autoResetGuide } from '../ability-engine.mjs';
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const cfg=structuredClone(DEFAULT_SETTINGS),model=buildModel(cfg),solution=solveModel(model);
const byType=id=>model.types.find(t=>t.members.includes(id)).id;
function findState(m,entries){return m.states.find(s=>s.v.every((v,i)=>m.types[v.type].members.includes(entries[i][0])&&(entries[i][1]===undefined||v.grade===entries[i][1])&&(entries[i][2]===undefined||v.met===entries[i][2])));}

test('published data has all 41 option identities and valid grade/value distributions',()=>{
  assert.equal(OPTIONS.length,41);assert.equal(new Set(OPTIONS.map(o=>o.id)).size,41);
  close(VALUE_PROBABILITIES.reduce((s,p)=>s+p,0),1);
  for(let g=0;g<3;g++) {
    close(OPTIONS.reduce((s,o)=>s+o.weights[g],0),100,.002);
    for(const o of OPTIONS)if(o.weights[g])assert.equal(o.values[g].length,6);
  }
});
test('cost conversion includes honor, meso, and maple points in the correct direction',()=>{
  const c=costsFor(cfg);assert.deepEqual(c.resets,[26000000,42000000,63000000]);close(c.circulator,4900/2200*1e8);
  assert.equal(costsFor({...cfg,medalPrice:0}).resets[0],2000000);
  assert.equal(costsFor({...cfg,marketRate:4400}).circulator,c.circulator/2);
});
test('cutoff probabilities aggregate repeated values and reverse level intervals',()=>{
  close(passProbability('boss',2,19),.25);close(passProbability('attack',2,30),.4);
  close(passProbability('attack',1,21),.25);close(passProbability('drop',2,19),.6);
  close(passProbability('level-attack',2,14),.8);close(passProbability('passive',2,1),1);
  close(passProbability('STR-DEX',2,35,20),.25);close(passProbability('boss',0,1),0);
});
test('invalid/empty/infinite prices and impossible, repeated, or invalid targets fail explicitly',()=>{
  for(const x of [-1,NaN,Infinity,''])assert.throws(()=>validateSettings({...cfg,medalPrice:x}));
  for(const x of [0,-1,NaN,Infinity,''])assert.throws(()=>validateSettings({...cfg,marketRate:x}));
  assert.throws(()=>validateSettings({...cfg,sets:[]}));
  assert.throws(()=>validateSettings({...cfg,sets:[[{option:'boss',min:19},{option:'boss',min:20},{option:'passive',min:1}]]}),/중복/);
  assert.throws(()=>validateSettings({...cfg,sets:[[{option:'boss',min:21},...cfg.sets[0].slice(1)]]}));
  assert.throws(()=>validateSettings({...cfg,sets:[[{option:'boss',min:19,secondaryMin:NaN},...cfg.sets[0].slice(1)]]}));
});
test('every action conserves mass and every state respects option multiplicities',()=>{
  for(const a of model.actions)close(a.outcomes.reduce((s,[,p])=>s+p,0),1,1e-10);
  for(const s of model.states){const counts=new Map();s.v.forEach(v=>counts.set(v.type,(counts.get(v.type)||0)+1));for(const [id,n]of counts)assert.ok(n<=model.types[id].count);}
});
// A separate direct formula enumerates the six permutations of the desired
// real identities, all grade combinations, and the fixed-identity exclusions.
function bruteGoalProbability(fixed=[]) {
  const goals=cfg.sets[0],totals=[0,1,2].map(g=>OPTIONS.reduce((s,o)=>s+o.weights[g],0));let total=0;
  function walk(line,used,p) {
    if(line===3){total+=p;return;}
    if(fixed[line]){walk(line+1,used,p);return;}
    for(const target of goals)if(!used.includes(target.option)) {
      const o=OPTION_BY_ID[target.option];
      for(let grade=0;grade<3;grade++) {
        const q=GRADE_PROBABILITIES[line][grade]*o.weights[grade]/(totals[grade]-used.reduce((s,id)=>s+OPTION_BY_ID[id].weights[grade],0))*passProbability(o,grade,target.min);
        if(q)walk(line+1,[...used,target.option],p*q);
      }
    }
  }
  walk(0,fixed.filter(Boolean),1);return total;
}
test('unlocked and third-line-locked goal probabilities match independent enumeration',()=>{
  const initial=model.actions[model.initialAction];close(initial.outcomes.reduce((p,[s,q])=>p+(model.states[s].goal?q:0),0),bruteGoalProbability(),1e-14);
  const state=findState(model,[['boss',2,true],['status',2,true],['passive',2,true]]);
  const action=model.actions[state.actions.find(id=>model.actions[id].mask===4)];
  close(action.outcomes.reduce((p,[s,q])=>p+(model.states[s].goal?q:0),0),bruteGoalProbability([null,null,'passive']),1e-14);
});
test('all six line assignments count and non-target temporary locks are available',()=>{
  const ids=['boss','passive','status'];
  for(const a of ids)for(const b of ids)for(const c of ids)if(new Set([a,b,c]).size===3){const s=findState(model,[[a,2,true],[b,2,true],[c,2,true]]);assert.ok(s.goal);assert.equal(solution.value[s.id],0);}
  const s=model.states.find(s=>s.v.every(v=>!v.eligible));
  assert.equal(s.actions.filter(id=>model.actions[id].kind==='reset').length,7);
  assert.ok(model.actions[s.actions[1]].fixed.some(Boolean));
});
test('circulator preserves all types and grades, rolls the whole tuple, and can lower achieved values',()=>{
  const s=findState(model,[['boss',2,true],['status',2,false],['passive',2,true]]);
  const a=model.actions[s.actions.find(id=>model.actions[id].kind==='circle')];assert.ok(a);
  for(const [id]of a.outcomes)model.states[id].v.forEach((v,i)=>{assert.equal(v.type,s.v[i].type);assert.equal(v.grade,s.v[i].grade);});
  assert.ok(a.outcomes.some(([id])=>!model.states[id].v[0].met&&model.states[id].v[1].met));
  close(a.outcomes.reduce((p,[id,q])=>p+(model.states[id].goal?q:0),0),.25*.6);
});
test('Bellman optimality holds over EVERY state and action, including rejection',()=>{
  let maxRelativeResidual=0;
  for(const s of model.states)if(!s.goal){const v=solution.value[s.id];let best=Infinity;
    for(const id of s.actions){const a=model.actions[id];const q=a.cost+a.outcomes.reduce((n,[t,p])=>n+p*Math.min(v,solution.value[t]),0);best=Math.min(best,q);}
    maxRelativeResidual=Math.max(maxRelativeResidual,Math.abs(best-v)/v);
  }
  assert.ok(maxRelativeResidual<1e-12,`relative residual ${maxRelativeResidual}`);
});
test('closed-form joint circulator success agrees when resetting is prohibitively expensive',()=>{
  const m=buildModel({...cfg,marketRate:1e9}),s=solveModel(m);
  const state=findState(m,[['boss',2,false],['status',2,false],['passive',2,true]]);
  close(s.value[state.id],m.costs.circulator/(.25*.6),1e-6);
  assert.equal(m.actions[s.policy[state.id]].kind,'circle');
});
test('bounds, expected quantities, comparison policies, and terminal probabilities reconcile',()=>{
  const lower=solveModel(model,{lowerBound:true}),noCircle=solveModel(model,{allowCircle:false}),finish=solveModel(model,{finishOnly:true});
  assert.ok(lower.initial<=solution.initial);assert.ok(solution.initial<=finish.initial+.001);assert.ok(finish.initial<=noCircle.initial+.001);
  close(solution.initialStats.reduce((s,n,i)=>s+n*(i===3?model.costs.circulator:model.costs.resets[i]),0),solution.initial,.01);
  const r=summarize(model,solution,lower,noCircle,finish);
  close(r.finishRanks.reduce((s,p)=>s+p,0),1,1e-10);
  assert.ok(r.circleUseProbability<=1+1e-10);assert.ok(r.circleUseProbability<=r.counts[3]);
  for(const id of solution.order)if(!model.states[id].goal){const a=model.actions[solution.policy[id]];assert.ok(a.outcomes.some(([t])=>improves(solution.value[t],solution.value[id])));}
});
test('ranked SETS do not accidentally permit mixtures of different sets',()=>{
  const settings={...cfg,sets:[cfg.sets[0],[{option:'speed',min:1},{option:'buff',min:50},{option:'crit',min:30}]]};
  const m=buildModel(settings,2);
  const mixed=findState(m,[['passive',2,true],['buff',2,true],['crit',2,true]]);assert.equal(mixed.goal,false);
  const second=findState(m,[['speed',2,true],['buff',2,true],['crit',2,true]]);assert.equal(second.goalRank,1);
  assert.ok(solveModel(m).initial<=solution.initial);
});
test('different minimum cutoffs for the same option remain distinguishable across ranks',()=>{
  const settings={...cfg,sets:[cfg.sets[0],[{option:'passive',min:1},{option:'boss',min:15},{option:'status',min:10}]]};
  const m=buildModel(settings,2),boss=m.types.find(t=>t.members.includes('boss')).id;
  const low=m.variants[0].find(v=>v.type===boss&&v.grade===2&&v.values.includes(15));
  assert.ok(low.mask);assert.ok(!(low.mask&2));assert.ok(low.mask&(1<<4));
  const s=m.states.find(s=>s.v[0]===low&&s.v[1].grade===2&&m.types[s.v[1].type].members.includes('passive')&&s.v[2].grade===2&&m.types[s.v[2].type].members.includes('status')&&s.v[2].values.includes(10));
  assert.equal(s.goalRank,1);
});
test('four sets are supported with decreasing costs and no simulation noise',()=>{
  const sets=[cfg.sets[0],[{option:'passive',min:1},{option:'boss',min:19},{option:'attack',min:30}],[{option:'buff',min:49},{option:'cooldown',min:19},{option:'crit',min:20}],[{option:'drop',min:20},{option:'meso',min:20},{option:'magic',min:30}]];
  let prev=Infinity;
  for(let rank=1;rank<=4;rank++){const m=buildModel({...cfg,sets},rank),s=solveModel(m);assert.ok(s.initial<=prev+.01);prev=s.initial;assert.ok(Number.isFinite(s.initial));}
});

test('unique stopping combines grade and value conditions, preserving implicit saved defaults',()=>{
  const goal={option:'status',min:8,minGrade:1};
  assert.deepEqual(qualifyingGrades(goal),[1,2]);
  assert.equal(goalMatchesValue(goal,1,7),false);
  assert.equal(goalMatchesValue(goal,1,8),true);
  assert.equal(goalMatchesValue(goal,2,9),true);
  assert.equal(goalMatchesValue({...goal,minGrade:2},1,8),false);
  assert.equal(goalMatchesValue({option:'status',min:8},1,8),true);
  assert.deepEqual(qualifyingGrades({option:'status',min:4}),[0,1,2]);
  assert.deepEqual(qualifyingGrades({option:'status',min:4,minGrade:1}),[1,2]);
  for(const minGrade of [-1,3,1.5,'1',null,NaN])assert.throws(()=>validateSettings({...cfg,sets:[[...cfg.sets[0].slice(0,2),{...goal,minGrade}]]}),/최소 등급/);
});
test('passive + boss 20 + unique status 8 terminates, but status 7 still needs improvement',()=>{
  const mixed={...cfg,sets:[[{option:'passive',min:1},{option:'boss',min:20},{option:'status',min:8,minGrade:1}]]};
  const m=buildModel(mixed),s=solveModel(m);
  const done=findState(m,[['passive',2,true],['boss',2,true],['status',1,true]]);
  const unfinished=findState(m,[['passive',2,true],['boss',2,true],['status',1,false]]);
  const higher=findState(m,[['passive',2,true],['boss',2,true],['status',2,true]]);
  assert.ok(done.goal);assert.equal(s.value[done.id],0);assert.ok(higher.goal);
  assert.ok(!unfinished.goal);assert.ok(s.value[unfinished.id]>0);
  close(passProbability('status',1,8),.25);
  const circle=m.actions[unfinished.actions.find(id=>m.actions[id].kind==='circle')];
  close(circle.outcomes.reduce((sum,[id,p])=>sum+(m.states[id].goal?p:0),0),.1*.25);
  const guide=autoResetGuide(m,s);
  assert.equal(guide.ignoreFirst,true);
  assert.deepEqual(guide.rows.map(r=>[r.option,r.grade,r.min]),[['boss',2,15],['passive',2,1]]);
  assertGuideCoversEveryImprovement(m,s,guide);
});
test('ranked sets with identical cutoffs and different minimum grades stay distinct',()=>{
  const first=[{option:'passive',min:1},{option:'boss',min:20},{option:'status',min:8,minGrade:2}];
  const second=[...first.slice(0,2),{...first[2],minGrade:1}];
  const settings={...cfg,sets:[first,second]},strict=solveModel(buildModel(settings,1));
  const m=buildModel(settings,2),s=solveModel(m);
  const unique=findState(m,[['passive',2,true],['boss',2,true],['status',1,true]]);
  const legendary=findState(m,[['passive',2,true],['boss',2,true],['status',2,true]]);
  assert.equal(unique.goalRank,1);assert.equal(legendary.goalRank,0);
  assert.ok(s.initial<strict.initial);
});

function assertGuideCoversEveryImprovement(m,s,guide,remaining=s.initial) {
  assert.ok(guide.covered&&guide.withinLimit);
  for(const [id]of m.actions[m.initialAction].outcomes)if(improves(s.value[id],remaining)) {
    assert.ok(m.states[id].v.some((v,line)=>(!guide.ignoreFirst||line>0)&&guide.rows.some(r=>
      v.grade===r.grade&&m.types[v.type].members.includes(r.option)&&v.values.every(value=>value>=r.min))),`missed state ${id}`);
  }
}
test('auto reset catches every useful result, including low values for later circulators',()=>{
  const guide=autoResetGuide(model,solution);
  assert.equal(guide.ignoreFirst,true);
  assert.deepEqual(guide.rows.map(r=>[r.option,r.grade,r.min]),[['boss',2,15],['status',2,9],['passive',2,1]]);
  assertGuideCoversEveryImprovement(model,solution,guide);
  const resetState=model.states.find(s=>!s.goal&&solution.policy[s.id]===model.initialAction);
  assert.deepEqual(describeState(model,solution,resetState.id).autoReset,guide);
  const lockedState=model.states.find(s=>!s.goal&&model.actions[solution.policy[s.id]].kind==='reset'&&model.actions[solution.policy[s.id]].mask!==0);
  assert.equal(describeState(model,solution,lockedState.id).autoReset,null);
});

// Small explicit outcome spaces isolate the registration problem from the MDP.
function guideFixture(entries) {
  const ids=[...new Set(entries.flatMap(e=>e.options.map(o=>o.option)))];
  const types=ids.map(id=>({members:[id],target:true}));
  const states=entries.map((e,id)=>({id,v:[0,1,2].map(line=>{
    const o=e.options.find(o=>o.line===line);
    return o?{type:ids.indexOf(o.option),grade:o.grade??2,eligible:true,values:[o.value??1]}:{type:0,grade:-1,eligible:false};
  })}));
  return [{types,states,initialAction:0,actions:[{outcomes:entries.map((_,id)=>[id,1/entries.length])}]},
    {initial:100,value:entries.map(e=>e.useful===false?100:0)}];
}
test('first-line exclusion stays off when a beneficial result occurs only in the first line',()=>{
  const [m,s]=guideFixture([{options:[{line:0,option:'passive'}]},{useful:false,options:[]}]);
  const guide=autoResetGuide(m,s);
  assert.equal(guide.ignoreFirst,false);assertGuideCoversEveryImprovement(m,s,guide);
});
test('auto reset covers joint alternatives instead of registering every candidate',()=>{
  const [m,s]=guideFixture([
    {options:[{line:1,option:'passive'},{line:2,option:'boss',value:15}]},
    {options:[{line:1,option:'passive'},{line:2,option:'status',value:9}]},
    {useful:false,options:[{line:0,option:'passive'}]},
  ]);
  const guide=autoResetGuide(m,s);
  assert.equal(guide.ignoreFirst,true);assert.deepEqual(guide.rows.map(r=>r.option),['passive']);
  assertGuideCoversEveryImprovement(m,s,guide);
});
test('more than six indispensable registrations are reported without dropping options',()=>{
  const ids=['passive','boss','status','attack','magic','crit','buff'];
  const [m,s]=guideFixture(ids.map(option=>({options:[{line:1,option}]})));
  const guide=autoResetGuide(m,s);
  assert.equal(guide.covered,true);assert.equal(guide.withinLimit,false);assert.equal(guide.rows.length,7);
  assert.deepEqual(new Set(guide.rows.map(r=>r.option)),new Set(ids));
});
test('epic-only useful results cannot be represented as a complete automatic stop guide',()=>{
  const [m,s]=guideFixture([{options:[{line:1,option:'status',grade:0,value:4}]}]);
  const guide=autoResetGuide(m,s);
  assert.equal(guide.covered,false);assert.equal(guide.missingProbability,1);assert.deepEqual(guide.rows,[]);
});
