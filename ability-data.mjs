// Source: supplied 2026-09-17 probability document, checked against Nexon's
// https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue
// Grade order: epic, unique, legendary. Published rounded weights are normalized.
export const GRADES = ['에픽', '유니크', '레전드리'];
export const VALUE_PROBABILITIES = [0.2, 0.2, 0.2, 0.15, 0.15, 0.1];
export const GRADE_PROBABILITIES = [[0, 0, 1], [0.83, 0.15, 0.02], [0.83, 0.15, 0.02]];
export const RESET_COSTS = [{ honor: 20000, meso: 2000000 }, { honor: 30000, meso: 6000000 }, { honor: 40000, meso: 15000000 }];
export const CIRCULATOR_POINTS = 4900;
const stats = [[15,16,17,18,19,20],[25,26,27,28,29,30],[35,36,37,38,39,40]];
const small = [[4,4,5,5,5,5],[7,7,7,7,8,8],[9,9,10,10,10,10]];
const percent = [null,[5,6,7,8,9,10],[15,16,17,18,19,20]];
const one = [null,null,[1,1,1,1,1,1]];
export const OPTIONS = [];
function add(id, label, weights, values, unit = '', lower = false, secondary = null) {
  OPTIONS.push({ id, label, weights, values, unit, lower, secondary });
}
for (const s of ['STR','DEX','INT','LUK']) add(s, `${s} 증가`, [4.1705,4.2254,4.1628], stats);
for (const s of ['HP','MP']) add(s, `최대 ${s} 증가`, [2.7804,2.3474,1.8501], [[225,240,255,270,285,300],[375,390,405,420,435,450],[525,540,555,570,585,600]]);
for (const [id,s] of [['attack','공격력'],['magic','마력']]) add(id, `${s} 증가`, [1.8536,1.4085,2.3127], [[6,6,9,9,9,12],[15,18,18,18,21,21],[27,27,27,30,30,30]]);
add('crit','크리티컬 확률 증가',[0.9268,0.4695,0.4625],[[5,6,7,8,9,10],[15,16,17,18,19,20],[25,26,27,28,29,30]],'%');
add('all','모든 능력치 증가',[2.7804,1.8779,1.8501],stats);
add('speed','공격 속도 단계 증가',[0,0,0.4625],one,'단계');
for (const [a,b] of [['STR','DEX'],['DEX','STR'],['INT','LUK'],['LUK','DEX']]) add(`ap-${a}-${b}`,`AP 투자 ${a}의 %만큼 ${b} 증가`,[2.7804,2.8169,2.3127],small,'%');
for (const [id,s] of [['level-attack','공격력'],['level-magic','마력']]) add(id,`일정 레벨마다 ${s} 1 증가`,[0,0,2.3127],[null,null,[16,14,14,12,12,10]],'레벨',true);
for (const s of ['HP','MP']) add(`${s}-percent`,`최대 ${s} % 증가`,[0,1.8779,1.8501],percent,'%');
add('boss','보스 몬스터 공격 시 데미지 증가',[0,0.9390,2.3127],percent,'%');
add('normal','일반 몬스터 공격 시 데미지 증가',[2.7804,1.8779,1.8501],small,'%');
add('status','상태 이상 대상 공격 시 데미지 증가',[2.7804,1.8779,1.8501],small,'%');
add('defense-damage','방어력의 %만큼 데미지 고정값 증가',[0,1.8779,1.8501],[null,[13,15,18,20,23,25],[38,40,43,45,48,50]],'%');
add('cooldown','스킬 재사용 대기시간 미적용',[0,1.8779,1.8501],percent,'%');
add('passive','패시브 스킬 레벨 증가',[0,0,0.7401],one,'레벨');
add('targets','다수 공격 스킬의 공격 대상 증가',[0,0,0.7401],one,'명');
add('buff','버프 스킬 지속 시간 증가',[1.3902,0.9390,0.9251],[[19,20,22,23,24,25],[32,33,34,35,37,38],[44,45,47,48,49,50]],'%');
for (const [id,s] of [['drop','아이템 드롭률'],['meso','메소 획득량']]) add(id,`${s} 증가`,[2.7804,1.8779,1.8501],[[8,8,9,9,10,10],[13,13,14,14,15,15],[18,18,19,19,20,20]],'%');
for (const a of ['STR','DEX','INT','LUK']) for (const b of ['STR','DEX','INT','LUK']) if(a!==b) add(`${a}-${b}`,`${a}, ${b} 증가`,[3.8925,3.7559,3.2377],stats,'',false,[[8,8,9,9,10,10],[13,13,14,14,15,15],[18,18,19,19,20,20]]);
export const OPTION_BY_ID = Object.fromEntries(OPTIONS.map(o=>[o.id,o]));
export const DEFAULT_SETTINGS = {
  sets: [[{option:'passive',min:1},{option:'boss',min:19},{option:'status',min:10}]],
  medalPrice: 6000000, marketRate: 2200,
};
export function costsFor({medalPrice,marketRate}) {
  return { resets: RESET_COSTS.map(c=>c.meso+c.honor*medalPrice/5000), circulator:CIRCULATOR_POINTS*1e8/marketRate };
}
export function passProbability(option, grade, min, secondaryMin = 0) {
  const o = typeof option==='string' ? OPTION_BY_ID[option] : option;
  return (o.values[grade] || []).reduce((p,v,i)=>p+((o.lower?v<=min:v>=min)&&(!o.secondary||o.secondary[grade][i]>=secondaryMin)?VALUE_PROBABILITIES[i]:0),0);
}
// Missing minGrade preserves saved settings: any grade meeting the value cutoff.
export function goalMatchesValue(goal, grade, value, secondaryValue = 0) {
  const o=OPTION_BY_ID[goal.option];
  return grade >= (goal.minGrade ?? 0) && (o.lower ? value <= goal.min : value >= goal.min)
    && (!o.secondary || secondaryValue >= (goal.secondaryMin ?? 0));
}
export function qualifyingGrades(goal) {
  return [0,1,2].filter(grade=>grade >= (goal.minGrade ?? 0)
    && passProbability(goal.option,grade,goal.min,goal.secondaryMin)>0);
}
export function validateSettings(s) {
  if (!Number.isFinite(s.medalPrice)||s.medalPrice<0) throw new Error('훈장 가격은 0 이상의 숫자로 입력해 주세요.');
  if (!Number.isFinite(s.marketRate)||s.marketRate<=0) throw new Error('메소마켓 시세는 0보다 큰 숫자로 입력해 주세요.');
  if (!Array.isArray(s.sets)||s.sets.length<1||s.sets.length>4) throw new Error('1~4순위 목표 세트를 입력해 주세요.');
  s.sets.forEach((set,rank)=> {
    if(!Array.isArray(set)||set.length!==3) throw new Error(`${rank+1}순위 세트는 세 옵션이 필요합니다.`);
    if(new Set(set.map(g=>g.option)).size!==3) throw new Error(`${rank+1}순위 세트에 같은 옵션 종류를 중복 지정할 수 없습니다.`);
    for (const g of set) {
      const o=OPTION_BY_ID[g.option];
      if(!o||!Number.isFinite(g.min)||g.min<=0||!Number.isFinite(g.secondaryMin??0)||(g.secondaryMin??0)<0) throw new Error(`${rank+1}순위 세트의 목표 수치를 확인해 주세요.`);
      if(g.minGrade!==undefined&&![0,1,2].includes(g.minGrade)) throw new Error(`${rank+1}순위: 최소 등급을 확인해 주세요.`);
      if(!qualifyingGrades(g).length) throw new Error(`${rank+1}순위: ${o.label}의 달성 가능한 수치를 입력해 주세요.`);
    }
  });
}
