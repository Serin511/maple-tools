/* ================================================================
   메이플스토리 잠재능력 재설정 장사 계산기
   - 등급업 확률/천장: 넥슨 공식 확률 페이지를 옮긴 기존 구현 (2026.07)
   - 재설정 비용: 나무위키 '잠재능력' 문서 (공식 표 전사본)
   - 옵션 가중치: 나무위키 '잠재능력/옵션 목록' (공식 확률표 분수 변환)
     + 모자 쿨감 배분 9:6, 유니크·레전 HP 가중치 12는 공식 확률 페이지로 보정 (2026.08~09)
     + 기존 주석에 200제 공식 크롤 JSON 1,356행 대조 이력 기재 (2026.09)
   원본 JSON은 저장소에 없어 이 이력을 재현하지 못한다. 출처·검증 범위는
   docs/potential-model.md에 기록한다.
   ================================================================ */

// ---------- 고정 데이터 ----------
export const GRADE_UP = { epic: 0.035, unique: 0.014 }; // 미라클데이 ×2 (천장/옵션확률 불변)
export const PITY = { epic: 42, unique: 107 };
export const ESCAPE = { line2: 0.2, line3: 0.05 }; // 이탈 확률 (공식)

export const COST_DEFAULT = {
  // 레벨 구간별 1회 비용 (메소)
  140: { epic: 16000000, unique: 34000000, legend: 40000000 },
  160: { epic: 17000000, unique: 36125000, legend: 42500000 },
  200: { epic: 18000000, unique: 38250000, legend: 45000000 },
  250: { epic: 20000000, unique: 42500000, legend: 50000000 },
};

// 부위별 옵션 풀 총 가중치 (에픽 / 유니크 / 레전드리)
export const POOL_TOTALS = {
  acc:    { epic: 70, unique: 80,  legend: 117 }, // 벨트 외 장신구
  belt:   { epic: 70, unique: 96,  legend: 99 },
  hat:    { epic: 70, unique: 104, legend: 123 },
  glove:  { epic: 82, unique: 112, legend: 120 },
  shoes:  { epic: 70, unique: 104, legend: 108 },
  cape:   { epic: 70, unique: 96,  legend: 99 }, // 망토·어깨장식
  top:    { epic: 76, unique: 124, legend: 117 },
  bottom: { epic: 70, unique: 104, legend: 99 },
  heart:  { epic: 70, unique: 80,  legend: 81 },
};

export const PART_LABELS = {
  acc: "벨트 외 장신구", belt: "벨트", hat: "모자", glove: "장갑", shoes: "신발",
  cape: "망토·어깨장식", top: "상의", bottom: "하의", heart: "기계심장",
};
export const ARMOR_PARTS = ["hat", "glove", "shoes", "cape", "belt", "top", "bottom"];

// 레벨별 옵션 수치 (스탯% / 올스탯% / HP%)
export const VALUES = {
  std: { stat: { epic: 6, unique: 9, legend: 12 }, all: { epic: 3, unique: 6, legend: 9 } },
  250: { stat: { epic: 7, unique: 10, legend: 13 }, all: { epic: 4, unique: 7, legend: 10 } },
};
export const STATS = ["STR", "DEX", "INT", "LUK"];

function validatePool(part, tier, level) {
  if (!Object.hasOwn(POOL_TOTALS, part)) throw new RangeError("지원하지 않는 잠재능력 부위입니다.");
  if (!["epic", "unique", "legend"].includes(tier)) throw new RangeError("지원하지 않는 잠재능력 등급입니다.");
  if (typeof level !== "number" || !Object.hasOwn(COST_DEFAULT, level)) throw new RangeError("지원 레벨은 140, 160, 200, 250입니다.");
}

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name}은 유한한 0 이상의 수여야 합니다.`);
}

function validateStack(j) {
  if (!Number.isInteger(j) || j < 0 || j > PITY.unique)
    throw new RangeError("천장 스택은 0~107의 정수여야 합니다.");
}

function validateTargets(targets) {
  if (!Array.isArray(targets)) throw new TypeError("판매 목표 목록이 필요합니다.");
  const ids = new Set();
  for (const t of targets) {
    if (!t || typeof t.id !== "string" || !t.id || t.id === "__floor" || ids.has(t.id))
      throw new RangeError("판매 목표 ID는 서로 달라야 합니다.");
    ids.add(t.id);
    nonnegative(t.price, "판매가");
    if (["stat", "hp", "allsum"].includes(t.kind)) nonnegative(t.min, "목표 수치");
    else if (t.kind === "hat" || t.kind === "glove") {
      nonnegative(t.kind === "hat" ? t.cd : t.crit, "목표 수치");
      nonnegative(t.statMin, "동반 스탯 수치");
      if (t.stat && !STATS.includes(t.stat)) throw new RangeError("지원하지 않는 동반 스탯입니다.");
    } else if (t.kind !== "dm" || !["drop2", "meso2", "dropmeso", "dm3"].includes(t.combo)) {
      throw new RangeError("지원하지 않는 판매 목표입니다.");
    }
    if (t.kind === "stat" && !STATS.includes(t.stat)) throw new RangeError("지원하지 않는 스탯입니다.");
  }
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") throw new TypeError("계산 설정이 필요합니다.");
  validatePool(cfg.part, "legend", cfg.level);
  validateTargets(cfg.targetsU); validateTargets(cfg.targetsL);
  nonnegative(cfg.fee, "수수료");
  if (cfg.fee > 100) throw new RangeError("수수료는 0~100%여야 합니다.");
  nonnegative(cfg.itemPrice, "매입가"); nonnegative(cfg.floorPrice, "깡통 처분가");
  for (const tier of ["epic", "unique", "legend"]) nonnegative(cfg.costs?.[tier], "재설정 비용");
  if (cfg.prime?.on) {
    nonnegative(cfg.prime.cost, "프라임 큐브 비용");
    if (cfg.prime.fixedKey !== "auto" && !primeAtomList(cfg.part, cfg.level).some((a) => a.key === cfg.prime.fixedKey))
      throw new RangeError("이 부위에서 고정할 수 없는 프라임 옵션입니다.");
  }
  return cfg;
}

// 부위 × 등급(tier)별 원자 옵션 목록 생성
export function buildTierAtoms(part, tier, level) {
  validatePool(part, tier, level);
  const v = level === 250 ? VALUES[250] : VALUES.std;
  const atoms = [];
  const add = (key, kind, weight, value = 0, max = 0) =>
    weight > 0 && atoms.push({ key, kind, weight, value, max });

  // 공통 추적 옵션
  const sw = tier === "epic" ? 10 : tier === "unique" ? 10 : 12;
  STATS.forEach((s) => add(s, "stat", sw, v.stat[tier]));
  add("ALL", "all", tier === "epic" ? 4 : tier === "unique" ? 8 : 9, v.all[tier]);
  add("HP", "hp", tier === "epic" ? 10 : 12, v.stat[tier]); // 공식: 유니크·레전드리 HP 가중치 12 (2026.09 공식 표 대조)

  // 부위 전용 (레전드리)
  if (tier === "legend") {
    if (part === "hat") { add("CD1", "cd", 9, 1); add("CD2", "cd", 6, 2); } // 공식: -1초 7.3171%(9/123), -2초 4.8780%(6/123)
    if (part === "glove") add("CRIT", "crit", 12, 8);
    if (part === "acc") { add("DROP", "drop", 9, 1); add("MESO", "meso", 9, 1); }
  }
  // 중복 제한 옵션 (재설정 확률 재계산 규칙 반영용)
  const usefulW = {
    hat: { unique: 8, legend: 9 }, bottom: { unique: 8, legend: 0 },
    shoes: { unique: 8, legend: 9 }, glove: { unique: 8, legend: 9 },
  };
  if (usefulW[part] && usefulW[part][tier]) add("USEFUL", "useful", usefulW[part][tier], 0, 1);
  if (part === "top") {
    if (tier === "epic") add("INVT", "invulT", 6, 0, 1);
    if (tier === "unique") { add("INVT", "invulT", 8, 0, 1); add("INVP", "invulP", 8, 0, 2); }
    if (tier === "legend") { add("INVT", "invulT", 9, 0, 1); add("INVP", "invulP", 9, 0, 2); }
  }
  if (ARMOR_PARTS.includes(part) && (tier === "unique" || tier === "legend"))
    add("DMGIG", "dmgIg", tier === "unique" ? 16 : 18, 0, 2);

  const total = POOL_TOTALS[part][tier];
  const used = atoms.reduce((s, a) => s + a.weight, 0);
  add("OTHER", "other", Math.max(0, total - used));
  return { atoms, total };
}

// ---------- 롤 분포 열거 엔진 ----------
// grade의 3줄 조합을 중복 제한(최대1/최대2) 규칙까지 반영해 정확 열거
export function enumerateRolls(part, level, grade, evalCombo, fixedAtom = null) {
  if (grade !== "unique" && grade !== "legend") throw new RangeError("판매 롤은 유니크 또는 레전드리만 지원합니다.");
  const lowTier = grade === "legend" ? "unique" : "epic";
  const hiPool = buildTierAtoms(part, grade, level);
  const loPool = buildTierAtoms(part, lowTier, level);

  const excludedW = (pool, st) => {
    let w = 0;
    for (const a of pool.atoms) {
      if (a.kind === "useful" && st.useful) w += a.weight;
      else if (a.kind === "invulT" && st.invulT) w += a.weight;
      else if (a.kind === "invulP" && st.invulP >= 2) w += a.weight;
      else if (a.kind === "dmgIg" && st.dmgIg >= 2) w += a.weight;
    }
    return w;
  };
  const nextState = (st, a) => ({
    useful: st.useful || a.kind === "useful",
    invulT: st.invulT || a.kind === "invulT",
    invulP: st.invulP + (a.kind === "invulP" ? 1 : 0),
    dmgIg: st.dmgIg + (a.kind === "dmgIg" ? 1 : 0),
  });
  const skip = (a, st) =>
    (a.kind === "useful" && st.useful) || (a.kind === "invulT" && st.invulT) ||
    (a.kind === "invulP" && st.invulP >= 2) || (a.kind === "dmgIg" && st.dmgIg >= 2);

  const st0 = { useful: false, invulT: false, invulP: 0, dmgIg: 0 };
  // 1줄: 표기 등급 100% (프라임 큐브: 고정 옵션 1개로 대체, p1 = 1)
  for (const a1 of fixedAtom ? [fixedAtom] : hiPool.atoms) {
    const p1 = fixedAtom ? 1 : a1.weight / hiPool.total;
    if (p1 <= 0) continue;
    const st1 = nextState(st0, a1);
    // 2줄: 이탈 20% / 하위 80%
    for (const [tierP2, pool2] of [[ESCAPE.line2, hiPool], [1 - ESCAPE.line2, loPool]]) {
      const ex2 = excludedW(pool2, st1);
      for (const a2 of pool2.atoms) {
        if (skip(a2, st1)) continue;
        const p2 = tierP2 * (a2.weight / (pool2.total - ex2));
        if (p2 <= 0) continue;
        const st2 = nextState(st1, a2);
        // 3줄: 이탈 5% / 하위 95%
        for (const [tierP3, pool3] of [[ESCAPE.line3, hiPool], [1 - ESCAPE.line3, loPool]]) {
          const ex3 = excludedW(pool3, st2);
          for (const a3 of pool3.atoms) {
            if (skip(a3, st2)) continue;
            const p3 = tierP3 * (a3.weight / (pool3.total - ex3));
            if (p3 <= 0) continue;
            evalCombo(p1 * p2 * p3, a1, a2, a3);
          }
        }
      }
    }
  }
}

// 3줄 조합 → 수치 합산
export function comboSums(a1, a2, a3) {
  const s = { STR: 0, DEX: 0, INT: 0, LUK: 0 };
  let hp = 0, crit = 0, cd = 0, drop = 0, meso = 0, allSum = 0;
  for (const a of [a1, a2, a3]) {
    if (a.kind === "stat") s[a.key] += a.value;
    else if (a.kind === "all") {
      allSum += a.value;
      STATS.forEach((k) => (s[k] += a.value));
    }
    else if (a.kind === "hp") hp += a.value;
    else if (a.kind === "crit") crit += a.value;
    else if (a.kind === "cd") cd += a.value;
    else if (a.kind === "drop") drop += 1;
    else if (a.kind === "meso") meso += 1;
  }
  const maxStat = Math.max(s.STR, s.DEX, s.INT, s.LUK);
  return { s, hp, crit, cd, drop, meso, maxStat, allSum };
}

export function targetSatisfied(t, sums) {
  // 모자/장갑 동반 스탯: 지정된 단일 스탯만 유효 (직업군별 아이템 분리)
  const statVal = t.stat ? sums.s[t.stat] : sums.maxStat;
  switch (t.kind) {
    case "stat": return sums.s[t.stat] >= t.min;
    case "allsum": return sums.allSum >= t.min;
    case "hp": return sums.hp >= t.min;
    case "hat": return sums.cd >= t.cd && (t.statMin === 0 || statVal >= t.statMin);
    case "glove": return sums.crit >= t.crit && (t.statMin === 0 || statVal >= t.statMin);
    case "dm":
      if (t.combo === "drop2") return sums.drop >= 2;
      if (t.combo === "meso2") return sums.meso >= 2;
      if (t.combo === "dropmeso") return sums.drop >= 1 && sums.meso >= 1;
      if (t.combo === "dm3") return sums.drop + sums.meso >= 3;
      return false;
    default: return false;
  }
}

// 스탯/HP/올스탯 타겟을 '같은 계열' 구간으로 묶기 — 서로 다른 스탯 간 교차 방지
export function familize(targets) {
  const fams = {}; const rest = [];
  for (const t of targets) {
    const fk = t.kind === "stat" ? "s:" + t.stat : t.kind === "hp" ? "hp" : t.kind === "allsum" ? "all" : null;
    if (fk) (fams[fk] = fams[fk] || []).push(t); else rest.push(t);
  }
  for (const k in fams) fams[k].sort((a, b) => a.min - b.min);
  return { fams, rest };
}
// 3줄 조합 → 표시용 라벨 (동일 구성 합산, 기타=미추적 옵션)
export const atomLabel = (a) =>
  a.kind === "stat" ? `${a.key}+${a.value}%`
  : a.kind === "all" ? `올스탯+${a.value}%`
  : a.kind === "hp" ? `HP+${a.value}%`
  : a.kind === "cd" ? `쿨감-${a.value}초`
  : a.kind === "crit" ? "크뎀+8%"
  : a.kind === "drop" ? "드랍" : a.kind === "meso" ? "메획" : "기타";
export function comboLabel(a1, a2, a3) {
  return [a1, a2, a3].map(atomLabel).sort((x, y) => (x === "기타") - (y === "기타") || x.localeCompare(y)).join(" · ");
}
// 3줄 합산값 → 충족 타겟 목록과 최고가 타겟 (스탯 계열은 구간 판정)
export function bestHit(fams, rest, sums) {
  let best = null; const hits = [];
  for (const fk in fams) {
    const v = fk === "hp" ? sums.hp : fk === "all" ? sums.allSum : sums.s[fk.slice(2)];
    let hit = null;
    for (const t of fams[fk]) { if (v >= t.min) hit = t; else break; }
    if (hit) hits.push(hit);
  }
  for (const t of rest) if (targetSatisfied(t, sums)) hits.push(t);
  for (const t of hits) if (!best || t.price > best.price) best = t;
  return { best, hits };
}

// 활성 타겟 집합에 대한 등급별 롤 통계
// 스탯 계열은 구간 판정: 매물 수치가 속한 '기준치 이상 ~ 같은 계열의 다음 기준치 미만' 구간의 가격 적용
// q: 판매 확률/회, rev: 수수료 반영 기대수익(판매 조건부), satisf: 타겟별 구간 도달 확률
// 기존 호출의 인자 순서는 유지하지만 올스탯 합산은 항상 적용한다.
export function gradeStats(part, level, grade, targets, _legacyAllstatCount, feeMul, combosOut, priceTargets = targets) {
  // 자동 홀드로 제외한 행도 가격 구간의 경계로 남는다. 낮은 가격의 상위
  // 구간을 제거했을 때 하위 구간의 높은 가격을 적용해서는 안 된다.
  const { fams, rest } = familize(priceTargets);
  const active = new Set(targets.map((t) => t.id));
  let q = 0, revSum = 0;
  const share = {}, satisf = {}; const cdf = [];
  enumerateRolls(part, level, grade, (p, a1, a2, a3) => {
    const sums = comboSums(a1, a2, a3);
    const hits = bestHit(fams, rest, sums).hits.filter((t) => active.has(t.id));
    const best = hits.reduce((b, t) => !b || t.price > b.price ? t : b, null);
    for (const t of hits) {
      satisf[t.id] = (satisf[t.id] || 0) + p;
      if (combosOut) {
        const m = combosOut[t.id] || (combosOut[t.id] = {});
        const key = comboLabel(a1, a2, a3);
        m[key] = (m[key] || 0) + p;
      }
    }
    if (best) {
      q += p;
      const rev = best.price * feeMul;
      revSum += p * rev;
      share[best.id] = (share[best.id] || 0) + p;
      cdf.push({ p, rev, tid: best.id });
    }
  });
  cdf.sort((a, b) => b.rev - a.rev);
  let acc = 0;
  const cum = cdf.map((e) => ({ c: (acc += e.p), rev: e.rev, tid: e.tid }));
  // 전체 질량을 합산할 때 발생하는 반올림이 음수 계속 확률을 만들지 않게 한다.
  const normalizedQ = Math.abs(1 - q) < 1e-12 ? 1 : Math.min(1, Math.max(0, q));
  return { q: normalizedQ, rev: q > 0 ? revSum / q : 0, share, satisf, cum };
}

// ---------- 프라임 큐브 (1줄 고정 · 2·3줄만 재설정 · 기존/신규 중 선택 적용) ----------
// 1줄로 고정 가능한 옵션 후보 (레전드리 풀의 추적 옵션)
export function primeAtomList(part, level) {
  return buildTierAtoms(part, "legend", level).atoms.filter((a) => ["stat", "all", "hp", "cd", "crit", "drop", "meso"].includes(a.kind));
}
// 프라임 단계 최적 정지. '선택 적용' 덕에 보유 옵션은 단조 증가 → 상태 = 현재 보유 최고가 타겟 구간 k (0 = 타겟 없음 → 깡통가)
//  V_k = max( v_k,  (−(C_p+g) + Σ_{m>k} P(m)·V_m) / (1 − P(new ≤ k)) )   — 새 롤 분포는 상태와 무관(1줄 고정)
//  N_k, R_k: 계속 시 기대 프라임 횟수 / 기대 판매 수익
// 기존 호출의 인자 순서는 유지하지만 올스탯 합산은 항상 적용한다.
export function solvePrime(part, level, fixedAtom, cands, _legacyAllstatCount, feeMul, floorPrice, Cp, g, autoExclude) {
  const { fams, rest } = familize(cands);
  const pById = {}; let pNone = 0;
  enumerateRolls(part, level, "legend", (p, a1, a2, a3) => {
    const { best } = bestHit(fams, rest, comboSums(a1, a2, a3));
    if (best) pById[best.id] = (pById[best.id] || 0) + p; else pNone += p;
  }, fixedAtom);
  const floorIds = new Set(autoExclude ? cands.filter((t) => t.price <= floorPrice).map((t) => t.id) : []);
  const floorProb = pNone + [...floorIds].reduce((s, id) => s + (pById[id] || 0), 0);
  const states = [{ id: "__floor", price: floorPrice, p: floorProb, t: null },
    ...cands.filter((t) => !floorIds.has(t.id)).map((t) => ({ id: t.id, price: t.price, p: pById[t.id] || 0, t })).sort((a, b) => a.price - b.price)];
  const K = states.length;
  const V = new Array(K), N = new Array(K), R = new Array(K), sell = new Array(K);
  let above = 0, sPV = 0, sPN = 0, sPR = 0; // m > k 합
  for (let k = K - 1; k >= 0; k--) {
    const v = states[k].price * feeMul;
    let cont = -Infinity, n = 0, r = 0;
    if (above > 1e-12) { cont = (-(Cp + g) + sPV) / above; n = (1 + sPN) / above; r = sPR / above; }
    const doSell = autoExclude ? v >= cont : (k > 0 || above <= 1e-12); // 수동 모드: 타겟이면 즉시 판매, 깡통이면 계속
    sell[k] = doSell; V[k] = doSell ? v : cont; N[k] = doSell ? 0 : n; R[k] = doSell ? v : r;
    above += states[k].p; sPV += states[k].p * V[k]; sPN += states[k].p * N[k]; sPR += states[k].p * R[k];
  }
  const idx = {}; states.forEach((st, i) => (idx[st.id] = i));
  for (const id of floorIds) idx[id] = 0;
  const cum = []; let c = 0; states.forEach((st, i) => { c += st.p; cum.push({ c, k: i }); });
  return { states, idx, V, N, R, sell, cum, probById: pById, pNone };
}

// ---------- 라운드 해석 엔진 (천장 이월 마르코프) ----------
// gShift: 재설정 1회의 기회비용(장기 회당 기대 이득). 판정(판매/홀드·최적 정지)에만 반영, 실제 비용 계산엔 미반영
export function buildEngine(cfg, gShift = 0) {
  validateConfig(cfg);
  if (cfg.prime?.on && cfg.prime.fixedKey === "auto")
    return optimizePrime(cfg, candidate => buildSpecificEngine(candidate, gShift));
  return buildSpecificEngine(cfg, gShift);
}

function buildSpecificEngine(cfg, gShift = 0) {
  validateConfig(cfg);
  if (!Number.isFinite(gShift)) throw new RangeError("기회비용은 유한한 수여야 합니다.");
  const { part, level, targetsU, targetsL, fee, miracle, costs, itemPrice, floorPrice, autoExclude } = cfg;
  const feeMul = 1 - fee / 100;
  const pE = Math.min(1, GRADE_UP.epic * (miracle ? 2 : 1));
  const pL = Math.min(1, GRADE_UP.unique * (miracle ? 2 : 1));
  const Ce = costs.epic, Cu = costs.unique, Cl = costs.legend;
  const g = Math.max(0, gShift);

  // 에픽 구간 기대 재설정 횟수 (42스택 도달 시 다음 재설정 확정 → 최대 43회)
  let epicRolls = 0;
  for (let k = 1; k <= PITY.epic + 1; k++) epicRolls += Math.pow(1 - pE, k - 1);
  const reentry = itemPrice + epicRolls * Ce;            // 판매 후 재진입 비용 (실비)
  const reentryEff = itemPrice + epicRolls * (Ce + g);   // 판정용: 에픽 구간 재설정의 기회비용 포함

  // 등급별 전체 타겟 구간 확률 + 조합 분해 (판정표 표시용) — 유니크/레전드리 가격·타겟 집합 분리
  const uCombos = {}, lCombos = {};
  const uAll = gradeStats(part, level, "unique", targetsU, undefined, feeMul, uCombos);
  const lAll = gradeStats(part, level, "legend", targetsL, undefined, feeMul, lCombos);
  const capaFrom = (st, list) => list.filter((t) => (st.satisf[t.id] || 0) > 1e-12);
  const uCap = capaFrom(uAll, targetsU), lCap = capaFrom(lAll, targetsL);

  // 유니크 판정: 0.97×판매가 > 재진입 비용 + 에픽 구간 재설정 기회비용
  // (천장은 캐릭터 귀속·이월 → 판매 후 새 매물로 같은 상태에 복귀. 단, 그 사이 에픽 재설정 ~22회는 다른 매물에 썼다면 g/회씩 벌었을 시간)
  const judgeU = {};
  uCap.forEach((t) => (judgeU[t.id] = t.price * feeMul > reentryEff));

  // 레전드리 판정: 최적 정지 그리디 (깡통 처분가도 후보로 포함)
  // V(S) = 활성 집합 S를 향해 계속 재설정할 때의 기대 순수익 (한 번 더 돌리는 비용 = 큐브값 + 기회비용 g)
  //  - S에 깡통 포함 → 다음 롤이 무조건 판매됨: V = 다음 롤 기대 판매가 − (C_leg + g)
  //  - 미포함 → V = E[수익|판매] − (C_leg + g) / q(S)
  const lCands = [...lCap];
  if (floorPrice > 0) lCands.push({ id: "__floor", kind: "floor", price: floorPrice, label: "깡통 처분" });
  lCands.sort((a, b) => b.price - a.price);
  const judgeL = {};
  let accepted = [];
  const contValue = (S) => {
    const real = S.filter((x) => x.kind !== "floor");
    const hasFloor = S.some((x) => x.kind === "floor");
    if (real.length === 0) return hasFloor ? floorPrice * feeMul - (Cl + g) : -Infinity;
    const st = gradeStats(part, level, "legend", real, undefined, feeMul, undefined, targetsL);
    if (hasFloor) return st.q * st.rev + (1 - st.q) * floorPrice * feeMul - (Cl + g);
    return st.q > 1e-12 ? st.rev - (Cl + g) / st.q : -Infinity;
  };
  if (lCands.length > 0) {
    accepted = [lCands[0]];
    judgeL[lCands[0].id] = true;
    for (let i = 1; i < lCands.length; i++) {
      const t = lCands[i];
      judgeL[t.id] = t.price * feeMul >= contValue(accepted);
      if (judgeL[t.id]) accepted.push(t);
    }
  }

  // 활성 집합 확정
  const activeU = autoExclude ? uCap.filter((t) => judgeU[t.id]) : uCap;
  const activeL = autoExclude ? accepted.filter((x) => x.kind !== "floor") : lCap;
  const floorAccepted = autoExclude
    ? accepted.some((x) => x.kind === "floor")
    : false; // 수동 모드에선 깡통은 폴백 전용

  const uSt = gradeStats(part, level, "unique", activeU, undefined, feeMul, undefined, targetsU);
  const lSt = gradeStats(part, level, "legend", activeL, undefined, feeMul, undefined, targetsL);

  // 레전드리 국면 3모드
  //  A) 활성 타겟 없음      → 승급 롤에서 깡통가로 즉시 처분
  //  B) 타겟 있음, 깡통 미채택 → 타겟 뜰 때까지 재설정: 추가 롤 (1-q)/q
  //  C) 타겟 있음, 깡통 채택  → 매 롤이 판매 조건: 승급 롤에서 즉시 판매 (타겟 or 깡통가)
  let legMode = activeL.length === 0 ? "A" : floorAccepted ? "C" : "B";
  let legHitFloor = legMode !== "B"; // 깡통가가 수익에 관여하는지
  let legRolls = legMode === "B" ? (1 - lSt.q) / Math.max(lSt.q, 1e-12) : 0;
  let legRev =
    legMode === "A" ? floorPrice * feeMul
    : legMode === "C" ? lSt.q * lSt.rev + (1 - lSt.q) * floorPrice * feeMul
    : lSt.rev;
  let legPrimeRolls = 0;

  // ---- 프라임 큐브 모드 (legMode "P") ----
  //  L1) 일반 재설정: 매 롤 max(판매가, 프라임 진입가치 V_k(1줄 고정 시), 깡통가, 계속 W) — W는 고정점
  //  L2) 프라임: solvePrime 최적 정지
  const Cp = cfg.prime?.cost || 0;
  const fixedAtom = cfg.prime?.on ? primeAtomList(part, level).find((a) => a.key === cfg.prime.fixedKey) : null;
  let prime = null, l1 = null;
  if (fixedAtom && lCap.length > 0) {
    prime = solvePrime(part, level, fixedAtom, lCap, undefined, feeMul, floorPrice, Cp, g, autoExclude);
    const { fams, rest } = familize(lCap);
    const cls = {};
    enumerateRolls(part, level, "legend", (p, a1, a2, a3) => {
      const { best } = bestHit(fams, rest, comboSums(a1, a2, a3));
      const fixed = a1.key === fixedAtom.key;
      const key = (best ? best.id : "_") + (fixed ? "|f" : "");
      const o = cls[key] || (cls[key] = { p: 0, best, fixed }); o.p += p;
    });
    const classes = Object.values(cls);
    const fv = floorPrice * feeMul;
    const alt = (o) => {
      const opts = [];
      if (o.best) opts.push({ v: o.best.price * feeMul, type: "sell", rev: o.best.price * feeMul, tid: o.best.id, pn: 0 });
      if (o.fixed) { const k = o.best ? prime.idx[o.best.id] : 0; opts.push({ v: prime.V[k], type: "prime", rev: prime.R[k], k, pn: prime.N[k] }); }
      if (autoExclude && floorPrice > 0) opts.push({ v: fv, type: "floor", rev: fv, tid: "__floor", pn: 0 });
      return opts.length ? opts.sort((a, b) => b.v - a.v)[0] : null;
    };
    let W = -Infinity;
    if (autoExclude) {
      // 종료 가치가 높은 후보부터 채택하여 계속 가치의 고정점을 직접
      // 푼다. 희귀 목표를 3000회 값 반복으로 잘라 생기는 오차를 피한다.
      const exits = classes.map((o) => ({ p: o.p, a: alt(o) })).filter((o) => o.a).sort((x, y) => y.a.v - x.a.v);
      let exitP = 0, valueSum = 0;
      for (const o of exits) {
        if (exitP > 0 && o.a.v < W) break;
        exitP += o.p; valueSum += o.p * o.a.v;
        W = (valueSum - Cl - g) / exitP;
      }
    }
    let q = 0, rev = 0, pn = 0, pEnter = 0, pFloor = 0; const l1Cum = [];
    for (const o of classes) {
      const a = alt(o);
      const exit = a && (autoExclude ? a.v >= W : true);
      if (!exit) continue;
      q += o.p; rev += o.p * a.rev; pn += o.p * a.pn;
      if (a.type === "prime") pEnter += o.p;
      if (a.type === "floor") pFloor += o.p;
      l1Cum.push({ c: q, type: a.type, rev: a.rev, tid: a.tid, k: a.k });
    }
    if (q > 1e-12) {
      legMode = "P";
      legRolls = (1 - q) / q; legRev = rev / q; legPrimeRolls = pn / q;
      legHitFloor = pFloor > 0 || prime.sell[0];
      const pPrimeRoll = pn / Math.max(pEnter, 1e-12);
      l1 = { q, cum: l1Cum, W, pEnter: pEnter / q, avgPrimeRolls: pPrimeRoll, fixedLabel: atomLabel(fixedAtom) };
      lCap.forEach((t) => { judgeL[t.id] = autoExclude ? t.price * feeMul >= W : true; });
    } else prime = null;
  }

  // 유니크 국면 후진 재귀 (j = 유→레 천장 스택, 0~107 · 107스택이면 다음 재설정 확정)
  const N = PITY.unique + 1; // 108개 상태
  const Fc = new Float64Array(N), Fr = new Float64Array(N), Fn = new Float64Array(N);
  const Fd = Array.from({ length: N }, () => new Float64Array(N));
  for (let j = N - 1; j >= 0; j--) {
    const up = j === N - 1 ? 1 : pL;
    const fail = 1 - up;
    Fc[j] = Cu + up * (legRolls * Cl + legPrimeRolls * Cp);
    Fn[j] = 1 + up * (legRolls + legPrimeRolls);
    Fr[j] = up * legRev;
    Fd[j][0] += up;
    if (fail > 0) {
      const saleP = fail * uSt.q, contP = fail * (1 - uSt.q);
      Fr[j] += saleP * uSt.rev;
      Fd[j][Math.min(j + 1, N - 1)] += saleP;
      if (contP > 0 && j + 1 < N) {
        Fc[j] += contP * Fc[j + 1]; Fr[j] += contP * Fr[j + 1]; Fn[j] += contP * Fn[j + 1];
        const nx = Fd[j + 1];
        for (let k = 0; k < N; k++) Fd[j][k] += contP * nx[k];
      }
    }
  }
  // 라운드(j0): 에픽 구간 + 유니크 진입 롤 + 체인
  const round = (j0) => {
    validateStack(j0);
    const c = epicRolls * Ce + (1 - uSt.q) * Fc[j0];
    const r = uSt.q * uSt.rev + (1 - uSt.q) * Fr[j0];
    const n = epicRolls + (1 - uSt.q) * Fn[j0];
    return { cost: c, rev: r, resets: n, profit: r - c - itemPrice };
  };
  const roundDist = (j0) => {
    validateStack(j0);
    const d = new Float64Array(N);
    d[j0] += uSt.q;
    for (let k = 0; k < N; k++) d[k] += (1 - uSt.q) * Fd[j0][k];
    return d;
  };

  // 정상 분포 π (천장 이월의 장기 평형)
  let pi = new Float64Array(N); pi[0] = 1;
  for (let it = 0; it < 300; it++) {
    const nx = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      if (pi[j] < 1e-14) continue;
      const d = roundDist(j);
      for (let k = 0; k < N; k++) nx[k] += pi[j] * d[k];
    }
    pi = nx;
  }
  let sRev = 0, sCost = 0, sResets = 0;
  for (let j = 0; j < N; j++) {
    if (pi[j] < 1e-14) continue;
    const r = round(j);
    sRev += pi[j] * r.rev; sCost += pi[j] * r.cost; sResets += pi[j] * r.resets;
  }
  return {
    pE, pL, epicRolls, reentry, reentryEff, gShift: g, feeMul,
    uCap, lCap, judgeU, judgeL, activeU, activeL, legMode, legHitFloor, prime, l1, legPrimeRolls,
    uProb: uAll.satisf, lProb: lAll.satisf, uCombos, lCombos,
    uSt, lSt, round, roundDist,
    steady: { rev: sRev, cost: sCost, resets: sResets, profit: sRev - sCost - itemPrice },
    breakeven: sRev - sCost,
  };
}

// 재설정 1회당 기대 이득 g를 최대화하는 정책 탐색 (Dinkelbach 고정점 반복)
//  판정은 g를 기회비용으로 쓰고, 그 판정으로 계산한 g가 다시 판정을 바꾸므로 수렴할 때까지 반복. 최고 g 정책 채택
function solveSpecificEngine(cfg) {
  let g = 0, best = null;
  for (let i = 0; i < 12; i++) {
    const eng = buildEngine(cfg, g);
    const gNew = eng.steady.resets > 1e-9 ? eng.steady.profit / eng.steady.resets : 0;
    if (!best || gNew > best.steady.profit / best.steady.resets + 1e-6) best = eng;
    if (Math.abs(gNew - g) < 1e4 || !cfg.autoExclude) break; // 1만 메소/회 이하 변화면 수렴
    g = gNew;
  }
  return best;
}

const profitPerReset = engine => engine.steady.resets > 1e-9
  ? engine.steady.profit / engine.steady.resets : 0;

// Compare complete buy/reset/sell policies, rather than the conditional value
// after obtaining a fixed first line. Every reset, including Prime, is counted.
// The no-Prime policy remains an option when none of the fixed lines improves it.
function optimizePrime(cfg, solve) {
  const baseline = solve({ ...cfg, prime: { ...cfg.prime, on: false } });
  const baselineProfitPerReset = profitPerReset(baseline);
  let selected = baseline, selectedAtom = null, bestCandidate = null;
  const candidates = primeAtomList(cfg.part, cfg.level).map(atom => {
    const candidate = solve({ ...cfg, prime: { ...cfg.prime, fixedKey: atom.key } });
    const metric = profitPerReset(candidate);
    const comparison = {
      fixedKey: atom.key, fixedLabel: atomLabel(atom), profitPerReset: metric,
      profit: candidate.steady.profit, resets: candidate.steady.resets,
      primeResets: candidate.legPrimeRolls,
    };
    if (!bestCandidate || metric > bestCandidate.profitPerReset + 1e-6) bestCandidate = comparison;
    if (metric > profitPerReset(selected) + 1e-6) {
      selected = candidate;
      selectedAtom = atom;
    }
    return comparison;
  });
  const hasTargets = baseline.lCap.length > 0;
  selected.resolvedPrime = {
    ...cfg.prime, on: selectedAtom !== null,
    fixedKey: selectedAtom?.key ?? (hasTargets ? bestCandidate?.fixedKey : null) ?? null,
  };
  selected.primeOptimization = {
    selectedFixedKey: selectedAtom?.key ?? null,
    selectedFixedLabel: selectedAtom ? atomLabel(selectedAtom) : null,
    bestFixedKey: hasTargets ? bestCandidate?.fixedKey ?? null : null,
    bestFixedLabel: hasTargets ? bestCandidate?.fixedLabel ?? null : null,
    profitPerReset: profitPerReset(selected), baselineProfitPerReset,
    improvementPerReset: profitPerReset(selected) - baselineProfitPerReset,
    baseline: { ...baseline.steady, profitPerReset: baselineProfitPerReset },
    candidates,
    reason: selectedAtom ? "selected" : hasTargets ? "no-benefit" : "no-targets",
  };
  return selected;
}

export function solveEngine(cfg) {
  validateConfig(cfg);
  return cfg.prime?.on && cfg.prime.fixedKey === "auto"
    ? optimizePrime(cfg, solveSpecificEngine) : solveSpecificEngine(cfg);
}

// ---------- 몬테카를로 (분포·구성비) ----------
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 매 실패를 반복하지 않고 기하분포의 대기 횟수를 직접 뽑는다.
// cap번째 시도는 천장으로 강제 성공한다.
export function sampleGeometric(probability, rnd, cap = Infinity) {
  if (probability >= 1) return 1;
  if (probability <= 0) return cap;
  return Math.min(cap, 1 + Math.floor(Math.log1p(-rnd()) / Math.log1p(-probability)));
}

export function runMC(eng, cfg, startJ, samples, mode = "chain", options = {}) {
  // chain: 천장 이월, independent: 매 표본을 같은 스택에서 시작,
  // campaign: 레전드리 등급업으로 천장이 소모될 때까지 여러 매물을 거래.
  validateConfig(cfg);
  validateStack(startJ);
  if (!Number.isInteger(samples) || samples < 1 || samples > 1_000_000)
    throw new RangeError("시뮬레이션 표본은 1~1,000,000의 정수여야 합니다.");
  if (!["chain", "independent", "campaign"].includes(mode)) throw new RangeError("지원하지 않는 시뮬레이션 모드입니다.");
  if (mode === "campaign" && eng.uSt.q >= 1 - 1e-14)
    throw new RangeError("유니크에서 항상 판매하면 천장 소모 캠페인은 종료되지 않습니다.");
  const maxRounds = options.maxRounds ?? 1_000_000;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new RangeError("시뮬레이션 거래 예산은 양의 정수여야 합니다.");
  const { costs, itemPrice, floorPrice } = cfg;
  const rnd = mulberry32(options.seed ?? 20260721);
  const sample = (cum, fallback, lower = 0) => {
    if (!cum.length) return { rev: fallback, tid: "__floor" };
    const last = cum[cum.length - 1];
    const r = lower + rnd() * (last.c - lower);
    for (const e of cum) if (r < e.c) return e;
    return last;
  };
  const profits = []; const tidCount = {};
  let totResets = 0, totRounds = 0, totProfit = 0, j = startJ;
  for (let i = 0; i < samples; i++) {
    if (mode !== "chain") j = startJ;
    let acc = 0, accResets = 0, legendHit = false;
    do {
      if (totRounds >= maxRounds) throw new RangeError("시뮬레이션 거래 예산을 초과했습니다. 해석 기대값을 확인하거나 표본 수를 줄이세요.");
      let resets = sampleGeometric(eng.pE, rnd, PITY.epic + 1);
      let cost = itemPrice + resets * costs.epic, rev = 0, tid = null;
      if (rnd() < eng.uSt.q) {
        const s = sample(eng.uSt.cum, 0); rev = s.rev; tid = "u|" + s.tid;
      } else {
        // 유니크 한 번에서 승급 또는 판매가 일어나기까지의 대기.
        const upP = eng.pL, stopP = upP + (1 - upP) * eng.uSt.q;
        const cap = PITY.unique - j + 1;
        const uniqueRolls = sampleGeometric(stopP, rnd, cap);
        resets += uniqueRolls; cost += uniqueRolls * costs.unique;
        const up = uniqueRolls === cap || rnd() < upP / stopP;
        if (!up) {
          j += uniqueRolls;
          const s = sample(eng.uSt.cum, 0); rev = s.rev; tid = "u|" + s.tid;
        } else {
          j = 0; legendHit = true;
          if (eng.legMode === "A") { rev = floorPrice * eng.feeMul; tid = "__floor"; }
          else if (eng.legMode === "P") {
            if (rnd() >= eng.l1.q) {
              const rolls = sampleGeometric(eng.l1.q, rnd);
              resets += rolls; cost += rolls * costs.legend;
            }
            const e = sample(eng.l1.cum, floorPrice * eng.feeMul);
            if (e.type === "sell") { rev = e.rev; tid = "l|" + e.tid; }
            else if (e.type === "floor") { rev = e.rev; tid = "__floor"; }
            else {
              let k = e.k;
              while (!eng.prime.sell[k]) {
                const lower = eng.prime.cum[k].c;
                const improveP = eng.prime.cum.at(-1).c - lower;
                if (!(improveP > 0)) throw new RangeError("프라임 시뮬레이션이 종료할 수 없습니다.");
                const rolls = sampleGeometric(improveP, rnd);
                resets += rolls; cost += rolls * cfg.prime.cost;
                k = sample(eng.prime.cum, 0, lower).k;
              }
              rev = eng.prime.states[k].price * eng.feeMul;
              tid = k === 0 ? "__floor" : "p|" + eng.prime.states[k].id;
            }
          } else if (eng.legMode === "C") {
            if (rnd() < eng.lSt.q) { const s = sample(eng.lSt.cum, 0); rev = s.rev; tid = "l|" + s.tid; }
            else { rev = floorPrice * eng.feeMul; tid = "__floor"; }
          } else {
            if (rnd() >= eng.lSt.q) {
              const rolls = sampleGeometric(eng.lSt.q, rnd);
              resets += rolls; cost += rolls * costs.legend;
            }
            const s = sample(eng.lSt.cum, floorPrice * eng.feeMul);
            rev = s.rev; tid = "l|" + s.tid;
          }
        }
      }
      acc += rev - cost; accResets += resets; totRounds++;
      tidCount[tid] = (tidCount[tid] || 0) + 1;
    } while (mode === "campaign" && !legendHit);
    profits.push(acc); totProfit += acc; totResets += accResets;
  }
  profits.sort((a, b) => a - b);
  const pct = (p) => profits[Math.min(profits.length - 1, Math.floor(p * profits.length))];
  return { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), tidCount, rounds: samples, compRounds: totRounds,
    avgProfit: totProfit / samples, avgResets: totResets / samples, avgRounds: totRounds / samples };
}

// 천장 소모(레전드리 도달)까지 라운드 반복 기대치 (j0 ≥ 0)
// 유니크 판매 라운드는 스택 유지/증가 → 자기·상향 전이 재귀를 후진으로 풀이
export function campaignStats(eng, j0, itemPrice) {
  validateStack(j0);
  nonnegative(itemPrice, "매입가");
  if (eng.uSt.q >= 1 - 1e-14)
    throw new RangeError("유니크에서 항상 판매하면 천장 소모 캠페인은 종료되지 않습니다.");
  const N = PITY.unique + 1;
  const P = new Float64Array(N), R = new Float64Array(N), Ro = new Float64Array(N);
  for (let j = N - 1; j >= 0; j--) {
    const d = eng.roundDist(j), r = eng.round(j);
    let p = r.profit, re = r.resets, ro = 1;
    for (let k = j + 1; k < N; k++) {
      if (d[k] < 1e-15) continue;
      p += d[k] * P[k]; re += d[k] * R[k]; ro += d[k] * Ro[k];
    }
    // j=0에서 d[0]은 승급 종료도 포함하므로 자기 전이는 최초 유니크 판매 확률만 사용한다.
    const denom = 1 - eng.uSt.q;
    P[j] = p / denom; R[j] = re / denom; Ro[j] = ro / denom;
  }
  const rounds = Math.max(Ro[j0], 1e-9);
  return { profit: P[j0], resets: R[j0], rounds, breakeven: (P[j0] + rounds * itemPrice) / rounds };
}
