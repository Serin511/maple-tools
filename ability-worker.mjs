import { buildModel, solveModel, summarize, describeState } from './ability-engine.mjs';
import { validateSettings, OPTION_BY_ID, GRADES } from './ability-data.mjs';
const cache=new Map();
self.onmessage=({data})=>{
  const {id,type}=data;
  try {
    if(type==='calculate') {
      cache.clear();validateSettings(data.settings);
      for(let rank=1;rank<=data.settings.sets.length;rank++) {
        self.postMessage({id,type:'progress',message:`${rank}순위까지 허용하는 전략을 계산하고 있습니다…`});
        const model=buildModel(data.settings,rank),solution=solveModel(model);
        const result=summarize(model,solution,solveModel(model,{lowerBound:true}),solveModel(model,{allowCircle:false}),solveModel(model,{finishOnly:true}));
        const variantLabels=model.variants.map(list=>list.map(v=>{
          const t=model.types[v.type],o=OPTION_BY_ID[t.members[0]];
          return {id:v.id,label:v.grade<0?`${t.members.map(id=>OPTION_BY_ID[id].label).join(' / ')} · 목표 미해당`:`${GRADES[v.grade]} · ${o.label} ${v.values.join('/')} ${o.unit}`,target:t.target};
        }).sort((a,b)=>Number(b.target)-Number(a.target)||a.id-b.id));
        cache.set(rank,{model,solution});
        self.postMessage({id,type:'result',result:{...result,variantLabels,initialVariants:model.states[result.starts[0].id].v.map(v=>v.id)}});
      }
      self.postMessage({id,type:'complete'});
    } else if(type==='detail') {
      const cached=cache.get(data.rank);if(!cached)throw new Error('목표를 다시 계산해 주세요.');
      const {model,solution}=cached;
      const stateId=data.stateId??model.index.get(model.key(...data.variants));
      if(stateId===undefined)throw new Error('같은 옵션은 중복 등장할 수 없습니다. 현재 옵션 조합을 확인해 주세요.');
      const detail=describeState(model,solution,stateId);
      self.postMessage({id,type:'detail',detail:{...detail,variants:model.states[stateId].v.map(v=>v.id)}});
    }
  } catch(error) {self.postMessage({id,type:'error',requestType:type,message:error.message||'계산 중 오류가 발생했습니다.'});}
};
