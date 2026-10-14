import { useState, useMemo, useEffect, useRef } from "react";
import { COST_DEFAULT, PART_LABELS, STATS, primeAtomList, atomLabel } from "./potential-engine.mjs";
import { normalizePotentialSettings, normalizePotentialPresets, migratePotentialPrices as migratePrices } from "./potential-settings.mjs";
import { preparePotentialConfig } from "./potential-calculator.mjs";
import { CalculatorHeader, CalculatorFooter, CalculatorCard, CalculateButton, PresetControls } from "./ui.jsx";
import "./potential.css";

// ---------- 포맷 ----------
const fmtMeso = (n) => {
  if (!isFinite(n)) return "—";
  const neg = n < 0; const a = Math.abs(n);
  let s;
  if (a >= 1e8) s = (a / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "억";
  else if (a >= 1e4) s = Math.round(a / 1e4).toLocaleString("ko-KR") + "만";
  else s = Math.round(a).toLocaleString("ko-KR");
  return (neg ? "-" : "") + s;
};
const fmtPct = (p) => (p * 100 < 0.01 && p > 0 ? "<0.01%" : (p * 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "%");

// ---------- 로컬 저장 (브라우저별 영구 저장 · 차단 환경에선 메모리 폴백) ----------
const storage = (() => {
  try {
    const s = window.localStorage; const k = "__mpc_test";
    s.setItem(k, "1"); s.removeItem(k);
    return s;
  } catch {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  }
})();
const SAVE_KEY = "mpc:auto:v1";
const PRESET_KEY = "mpc:presets:v1";
const loadJSON = (k, fb) => { try { const v = JSON.parse(storage.getItem(k) || "null"); return v ?? fb; } catch { return fb; } };
const saveJSON = (k, v) => { try { storage.setItem(k, JSON.stringify(v)); } catch {} };
// ---------- UI ----------
const C = {
  bg: "var(--ui-bg)", panel: "var(--ui-panel)", panel2: "var(--ui-input)", border: "var(--ui-border)",
  text: "var(--ui-text)", sub: "var(--ui-muted)", accent: "#ffab68",
  epic: "#b07df7", unique: "#f2c744", legend: "#79e07d", prime: "#5ec8f2", danger: "#f27a6a", ok: "#79e07d",
};
const inputStyle = {
  background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text,
  padding: "9px 10px", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit",
};
const Num = ({ value, onChange, w = 72, ph = "", label, max, step = "any" }) => (
  <input aria-label={label} type="number" min="0" max={max} value={value} placeholder={ph} onChange={(e) => onChange(e.target.value)}
    style={{ ...inputStyle, width: w, textAlign: "center" }} step={step} />
);
const Toggle = ({ on, set, label, color = C.accent }) => (
  <button type="button" className="potential-toggle" role="switch" aria-checked={on} onClick={() => set(!on)} style={{
    display: "flex", alignItems: "center", gap: 8, background: "none", border: "none",
    cursor: "pointer", color: C.text, fontSize: 13, padding: 0, fontFamily: "inherit" }}>
    <span style={{
      width: 34, height: 19, borderRadius: 10, background: on ? color : "#3a4250",
      position: "relative", transition: "background .15s", flexShrink: 0 }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 17 : 2, width: 15, height: 15,
        borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
    </span>
    {label}
  </button>
);
const Badge = ({ kind, children }) => (
  <span style={{
    fontSize: 11, padding: "2px 8px", borderRadius: 999, fontWeight: 600,
    background: kind === "sell" ? "rgba(121,224,125,.15)" : kind === "hold" ? "rgba(242,122,106,.15)" : "rgba(154,163,173,.15)",
    color: kind === "sell" ? C.ok : kind === "hold" ? C.danger : C.sub }}>{children}</span>
);

export default function App() {
  const [initial] = useState(() => normalizePotentialSettings(loadJSON(SAVE_KEY, null)));
  const [level, setLevel] = useState(initial?.level ?? 200);
  const [part, setPart] = useState(initial?.part ?? "acc");
  const [itemPriceEok, setItemPriceEok] = useState(initial?.itemPriceEok ?? "3");
  const [fee, setFee] = useState(initial?.fee ?? "3");
  const [pity, setPity] = useState(initial?.pity ?? "0");
  const [floorEok, setFloorEok] = useState(initial?.floorEok ?? "1.5");
  const [miracle, setMiracle] = useState(!!initial?.miracle);
  const [autoExclude, setAutoExclude] = useState(initial ? initial.autoExclude !== false : true);
  const [allstatCount, setAllstatCount] = useState(initial ? initial.allstatCount !== false : true);
  const [costs, setCosts] = useState(initial?.costs ?? { ...COST_DEFAULT[initial?.level ?? 200] });
  const [statPrices, setStatPrices] = useState(() => migratePrices(initial?.statPrices ?? {}));
  const [hatRows, setHatRows] = useState(initial.hatRows);
  const [gloveRows, setGloveRows] = useState(initial.gloveRows);
  const [accPrices, setAccPrices] = useState(initial?.accPrices ?? { drop2: "", meso2: "", dropmeso: "", dm3: "" });
  const [pityMode, setPityMode] = useState(initial?.pityMode ?? "single"); // 스택>0 표시 모드: single | campaign
  const [primeOn, setPrimeOn] = useState(!!initial?.primeOn);
  const [primeCostEok, setPrimeCostEok] = useState(initial?.primeCostEok ?? "7");
  const [primeFixed, setPrimeFixed] = useState(initial?.primeFixed ?? "STR");
  const primeOpts = useMemo(() => primeAtomList(part, level), [part, level]);
  useEffect(() => { if (!primeOpts.some((a) => a.key === primeFixed)) setPrimeFixed(primeOpts[0].key); }, [primeOpts, primeFixed]);

  const firstLevelRun = useRef(true);
  const skipCostReset = useRef(false);
  useEffect(() => {
    if (firstLevelRun.current) { firstLevelRun.current = false; return; } // 마운트 시 복원값 보존
    if (skipCostReset.current) { skipCostReset.current = false; return; } // 프리셋 적용 시 보존
    setCosts({ ...COST_DEFAULT[level] });
  }, [level]);

  const [resetArm, setResetArm] = useState(false);
  useEffect(() => {
    if (!resetArm) return;
    const t = setTimeout(() => setResetArm(false), 3000);
    return () => clearTimeout(t);
  }, [resetArm]);
  const clearAllPrices = () => {
    if (!resetArm) { setResetArm(true); return; }
    setStatPrices({});
    setAccPrices({ drop2: "", meso2: "", dropmeso: "", dm3: "" });
    setHatRows((rows) => rows.map((r) => ({ ...r, price: "" })));
    setGloveRows((rows) => rows.map((r) => ({ ...r, price: "" })));
    setResetArm(false);
  };

  // ---------- 자동 저장 & 프리셋 ----------
  const snap = () => ({ level, part, itemPriceEok, fee, pity, floorEok, miracle, autoExclude, allstatCount, costs, statPrices, hatRows, gloveRows, accPrices, pityMode, primeOn, primeCostEok, primeFixed });
  useEffect(() => {
    const t = setTimeout(() => saveJSON(SAVE_KEY, snap()), 400);
    return () => clearTimeout(t);
  }, [level, part, itemPriceEok, fee, pity, floorEok, miracle, autoExclude, allstatCount, costs, statPrices, hatRows, gloveRows, accPrices, pityMode, primeOn, primeCostEok, primeFixed]);

  const [presets, setPresets] = useState(() => normalizePotentialPresets(loadJSON(PRESET_KEY, {})));
  const [presetName, setPresetName] = useState("");
  const [presetSel, setPresetSel] = useState("");
  const [hoverTid, setHoverTid] = useState(null);
  const applySnapshot = (s) => {
    if (!s) return;
    s = normalizePotentialSettings(s);
    if (s.level && s.level !== level) skipCostReset.current = true;
    if (s.level) setLevel(s.level);
    if (s.part) setPart(s.part);
    setItemPriceEok(s.itemPriceEok ?? "3"); setFee(s.fee ?? "3"); setPity(s.pity ?? "0"); setFloorEok(s.floorEok ?? "1.5");
    setMiracle(!!s.miracle); setAutoExclude(s.autoExclude !== false); setAllstatCount(s.allstatCount !== false);
    setCosts(s.costs ?? { ...COST_DEFAULT[s.level ?? 200] });
    setStatPrices(migratePrices(s.statPrices ?? {}));
    setHatRows(s.hatRows);
    setGloveRows(s.gloveRows);
    setAccPrices(s.accPrices ?? { drop2: "", meso2: "", dropmeso: "", dm3: "" });
    if (s.pityMode) setPityMode(s.pityMode);
    setPrimeOn(!!s.primeOn); setPrimeCostEok(s.primeCostEok ?? "7"); if (s.primeFixed) setPrimeFixed(s.primeFixed);
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const next = { ...presets, [name]: snap() };
    setPresets(next); saveJSON(PRESET_KEY, next);
    setPresetSel(name); setPresetName("");
  };
  const deletePreset = () => {
    if (!presetSel) return;
    const next = { ...presets }; delete next[presetSel];
    setPresets(next); saveJSON(PRESET_KEY, next);
    setPresetSel("");
  };

  const thresholds = useMemo(() => (level === 250 ? [14, 15, 17, 18, 20, 21, 23, 24, 26, 27, 30, 33, 36, 39] : [12, 15, 18, 21, 24, 27, 30, 33, 36]), [level]);
  const allThresholds = useMemo(() => (level === 250 ? [18, 21, 24, 27, 30] : [18, 21, 24, 27]), [level]);
  const statMinOpts = level === 250 ? [0, 7, 10, 13, 14, 17, 20, 23, 26] : [0, 6, 9, 12, 18, 21];

  const [priceGrade, setPriceGrade] = useState("u"); // 판매가 입력 탭: u(유니크) | l(레전드리)
  const copyPricesToOther = () => {
    const from = priceGrade, to = priceGrade === "u" ? "l" : "u";
    setStatPrices((sp) => {
      const next = { ...sp };
      for (const k in sp) if (k.startsWith(from + ":")) next[to + ":" + k.slice(2)] = sp[k];
      return next;
    });
  };

  // 타겟 목록 구성 — 유니크/레전드리 가격 집합 분리 (구간 경계도 등급별 입력값 기준)
  const targets = useMemo(() => {
    const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n * 1e8 : null; };
    const build = (g) => {
      const list = [];
      if (part !== "glove") {
        for (const st of [...STATS, "HP"])
          for (const th of thresholds) {
            const p = num(statPrices[`${g}:${st}_${th}`]);
            if (p) list.push({ id: `${st}_${th}`, kind: st === "HP" ? "hp" : "stat", stat: st, min: th, price: p,
              base: `${st === "HP" ? "MaxHP" : st} ${th}%`, range: `${th}%↑` });
          }
        for (const th of allThresholds) {
          const p = num(statPrices[`${g}:ALL_${th}`]);
          if (p) list.push({ id: `ALL_${th}`, kind: "allsum", min: th, price: p, base: `올스탯 ${th}%`, range: `${th}%↑` });
        }
      }
      if (part === "hat") hatRows.forEach((r, i) => {
        const p = num(r.price);
        if (p) list.push({ id: `hat_${i}`, kind: "hat", cd: r.cd, statMin: r.statMin, stat: r.statMin ? (r.stat || "STR") : null, price: p,
          base: `쿨감 ${r.cd}초↑${r.statMin ? ` + ${r.stat || "STR"} ${r.statMin}%↑` : ""}`, range: "" });
      });
      if (part === "glove") gloveRows.forEach((r, i) => {
        const p = num(r.price);
        if (p) list.push({ id: `glove_${i}`, kind: "glove", crit: r.crit, statMin: r.statMin, stat: r.statMin ? (r.stat || "STR") : null, price: p,
          base: `크뎀 ${r.crit}%↑${r.statMin ? ` + ${r.stat || "STR"} ${r.statMin}%↑` : ""}`, range: "" });
      });
      if (part === "acc") {
        const labels = { drop2: "드랍 2줄↑", meso2: "메획 2줄↑", dropmeso: "드랍+메획 각 1줄↑", dm3: "드메 합 3줄" };
        for (const k of Object.keys(labels)) {
          const p = num(accPrices[k]);
          if (p) list.push({ id: `dm_${k}`, kind: "dm", combo: k, price: p, base: labels[k], range: "" });
        }
      }
      // 스탯 계열 구간 표기 (같은 계열의 다음 입력 기준치 미만)
      const famKey = (t) => t.kind === "stat" ? "s:" + t.stat : t.kind === "hp" ? "hp" : t.kind === "allsum" ? "all" : null;
      const byFam = {};
      list.forEach((t) => { const k = famKey(t); if (k) (byFam[k] = byFam[k] || []).push(t); });
      for (const k in byFam) {
        byFam[k].sort((a, b) => a.min - b.min);
        byFam[k].forEach((t, i, arr) => { if (arr[i + 1]) t.range = `${t.min}~${arr[i + 1].min - 1}%`; });
      }
      list.forEach((t) => { t.label = t.range ? t.base.replace(`${t.min}%`, t.range) : t.base; });
      return list;
    };
    return { u: build("u"), l: build("l") };
  }, [part, thresholds, allThresholds, statPrices, hatRows, gloveRows, accPrices]);

  // 판정표 행: 두 등급 타겟의 합집합
  const rowIds = []; const byId = {};
  [...targets.u, ...targets.l].forEach((t) => { if (!byId[t.id]) { byId[t.id] = { base: t.base, u: null, l: null }; rowIds.push(t.id); } });
  targets.u.forEach((t) => (byId[t.id].u = t)); targets.l.forEach((t) => (byId[t.id].l = t));

  const cfgInput = useMemo(() => ({
    targetsU: targets.u, targetsL: targets.l, part, level, allstatCount, miracle, autoExclude, fee, costs, itemPriceEok, floorEok, pity, pityMode,
    primeOn, primeCostEok, primeFixed,
    priceInputs: [
      ...(part !== "glove" ? ["u", "l"].flatMap(grade => [
        ...[...STATS, "HP"].flatMap(stat => thresholds.map(threshold => statPrices[`${grade}:${stat}_${threshold}`] ?? "")),
        ...allThresholds.map(threshold => statPrices[`${grade}:ALL_${threshold}`] ?? ""),
      ]) : []),
      ...(part === "hat" ? hatRows.map(row => row.price) : []),
      ...(part === "glove" ? gloveRows.map(row => row.price) : []),
      ...(part === "acc" ? Object.values(accPrices) : []),
    ],
  }), [thresholds, allThresholds, statPrices, hatRows, gloveRows, accPrices, targets, part, level, allstatCount, miracle, autoExclude, fee, costs, itemPriceEok, floorEok, pity, pityMode, primeOn, primeCostEok, primeFixed]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('판매가를 입력하면 자동으로 계산합니다.');
  const [recalculate, setRecalculate] = useState(0);
  const worker = useRef(null);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    worker.current?.terminate();
    worker.current = null;
    setResult(null);
    setHoverTid(null);
    setBusy(false);
    try { preparePotentialConfig(cfgInput); }
    catch (failure) { setResult({ error: failure.message }); setProgress(''); return; }
    if (!cfgInput.targetsU.length && !cfgInput.targetsL.length) {
      setProgress('판매가를 입력하면 자동으로 계산합니다.');
      return;
    }
    setBusy(true);
    setProgress('입력한 판매 조건을 준비하고 있습니다…');
    const timer = setTimeout(() => {
      try {
        const source = document.getElementById('potential-worker-source');
        if (!source) throw new Error('계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
        const url = URL.createObjectURL(new Blob([JSON.parse(source.textContent)], { type: 'text/javascript' }));
        let engine;
        try { engine = new Worker(url); } finally { URL.revokeObjectURL(url); }
        worker.current = engine;
        engine.onmessage = ({ data }) => {
          if (request.current !== id || data.id !== id) return;
          if (data.type === 'progress') setProgress(data.message);
          if (data.type === 'result' || data.type === 'error') {
            setResult(data.type === 'result' ? data.result : { error: data.message });
            setProgress(data.type === 'result' ? '계산 완료' : '');
            setBusy(false);
            engine.terminate();
            worker.current = null;
          }
        };
        engine.onerror = () => {
          if (request.current !== id) return;
          setResult({ error: '계산 엔진을 실행하지 못했습니다. 다시 계산해 주세요.' });
          setBusy(false); setProgress(''); engine.terminate(); worker.current = null;
        };
        engine.postMessage({ id, settings: cfgInput });
      } catch (failure) {
        if (request.current !== id) return;
        setResult({ error: failure.message }); setBusy(false); setProgress('');
      }
    }, 150);
    return () => { clearTimeout(timer); request.current += 1; worker.current?.terminate(); worker.current = null; };
  }, [cfgInput, recalculate]);

  const gradeChip = (label, color, sub) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ color, fontWeight: 700, fontSize: 14 }}>{label}</span>
      <span style={{ color: C.sub, fontSize: 11, whiteSpace: "nowrap" }}>{sub}</span>
    </div>
  );

  const eng = result && !result.error ? result.eng : null;
  const judgedMap = {};
  if (eng) {
    for (const id of rowIds) {
      const inU = eng.uCap.some((x) => x.id === id);
      const inL = eng.lCap.some((x) => x.id === id);
      judgedMap[id] = {
        u: inU ? !!eng.judgeU[id] : null,        // 유니크: 판매(true)/홀드(false)/도달불가(null)
        l: inL ? !!eng.judgeL[id] : null,        // 레전드리 판정 (최적 정지)
      };
    }
  }
  const sr = eng ? !!result.singleRound : false;
  const pm = sr ? result.pityMode : null;
  const disp = eng
    ? (sr && pm === "campaign" && result.camp
      ? { profit: result.camp.profit, resets: result.camp.resets, breakeven: result.camp.breakeven }
      : sr
        ? { profit: result.first.profit, resets: result.first.resets, breakeven: result.first.rev - result.first.cost }
        : { profit: eng.steady.profit, resets: eng.steady.resets, breakeven: eng.breakeven })
    : null;
  const compTotal = result && result.mc ? (result.mc.compRounds || result.mc.rounds) : 0;
  const compEntries = result && result.mc
    ? Object.entries(result.mc.tidCount).sort((a, b) => b[1] - a[1]).map(([tid, n]) => {
        if (tid === "__floor") return { label: "레전 깡통 처분", share: n / compTotal };
        const g = tid.slice(0, 1), id = tid.slice(2);
        const t = g === "u" ? byId[id]?.u : byId[id]?.l;
        return { label: `${t ? t.label : id} · ${g === "u" ? "유니크" : g === "p" ? "레전드리 (프라임)" : "레전드리"}`, share: n / compTotal };
      })
    : [];

  return (
    <main className="calculator-page potential-page">
      <CalculatorHeader eyebrow="POTENTIAL TRADE" scope="일반 잠재능력"
        title={<>잠재능력 <em>장사 계산기</em></>}
        description={<>매입가와 판매 시세로 재설정 장사의 기대 수익을 계산합니다.<br />등급업 천장 이월과 판매·홀드 최적 정책을 비교하세요.</>} />
      <CalculatorCard as="div" className="potential-grade-path">
          <div className="potential-grade-steps">
            {gradeChip("에픽", C.epic, `${fmtMeso(+costs.epic)}/회`)}
            <span style={{ color: C.sub, fontSize: 12 }}>{miracle ? "7%" : "3.5%"} · 천장42 →</span>
            {gradeChip("유니크", C.unique, `${fmtMeso(+costs.unique)}/회`)}
            <span style={{ color: C.sub, fontSize: 12 }}>{miracle ? "2.8%" : "1.4%"} · 천장107 →</span>
            {gradeChip("레전드리", C.legend, `${fmtMeso(+costs.legend)}/회`)}
            {primeOn && <><span style={{ color: C.sub, fontSize: 12 }}>1줄 고정 →</span>
              {gradeChip("프라임", C.prime, `${fmtMeso((parseFloat(primeCostEok) || 0) * 1e8)}/회`)}</>}
          </div>
        </CalculatorCard>

        <div className="calculator-layout potential-layout">
          {/* 좌측: 설정 */}
          <aside className="calculator-settings potential-settings" aria-label="잠재능력 장사 설정">
            <CalculatorCard as="div" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em" }}>장비 설정</div>
              <label style={{ fontSize: 12, color: C.sub }}>노작 매입가 (억 메소)
                <Num value={itemPriceEok} onChange={setItemPriceEok} w="100%" /></label>
              <label style={{ fontSize: 12, color: C.sub }}>레벨 제한
                <select aria-label="레벨 제한" value={level} onChange={(e) => setLevel(+e.target.value)} style={inputStyle}>
                  {[140, 160, 200, 250].map((l) => <option key={l} value={l}>{l}제</option>)}
                </select></label>
              <label style={{ fontSize: 12, color: C.sub }}>착용 부위
                <select aria-label="착용 부위" value={part} onChange={(e) => setPart(e.target.value)} style={inputStyle}>
                  {Object.entries(PART_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label style={{ fontSize: 12, color: C.sub }}>현재 유→레 천장 스택 (0~107)
                <Num value={pity} onChange={setPity} w="100%" max={107} step="1" /></label>
              <label style={{ fontSize: 12, color: C.sub }}>경매장 수수료 (%)
                <Num value={fee} onChange={setFee} w="100%" max={100} /></label>
              <label style={{ fontSize: 12, color: C.sub }}>레전 깡통·잡옵 처분가 (억, 폴백용)
                <Num value={floorEok} onChange={setFloorEok} w="100%" /></label>
            </CalculatorCard>
            <CalculatorCard as="div" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Toggle on={miracle} set={setMiracle} label="미라클데이 (등급업 확률 ×2)" color="#f2c744" />
              <Toggle on={autoExclude} set={setAutoExclude} label="홀드 판정 타겟 자동 제외 (최적 정책)" />
              <Toggle on={allstatCount} set={setAllstatCount} label="올스탯 줄을 스탯 합산에 포함" />
            </CalculatorCard>
            <CalculatorCard as="div" style={{ background: C.panel, border: `1px solid ${primeOn ? C.prime + "66" : C.border}`, borderRadius: 14, padding: "var(--ui-card-padding, 22px)", display: "flex", flexDirection: "column", gap: 10 }}>
              <Toggle on={primeOn} set={setPrimeOn} label="프라임 큐브 모드 (레전드리 1줄 고정)" color={C.prime} />
              {primeOn && (
                <>
                  <label style={{ fontSize: 12, color: C.sub }}>프라임 큐브 가격 (억 메소 / 회)
                    <Num value={primeCostEok} onChange={setPrimeCostEok} w="100%" /></label>
                  <label style={{ fontSize: 12, color: C.sub }}>고정할 1줄 옵션
                    <select value={primeFixed} onChange={(e) => setPrimeFixed(e.target.value)} style={inputStyle}>
                      {primeOpts.map((a) => <option key={a.key} value={a.key}>{atomLabel(a)}</option>)}
                    </select></label>
                  <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.5 }}>
                    레전 도달 후 일반 재설정으로 1줄에 이 옵션이 뜨면 프라임으로 전환(2·3줄만 재설정, 기존/신규 중 선택 적용).
                    유효 옵션이 먼저 뜨면 판매 — 둘 다 해당하면 판매가와 프라임 계속 가치 중 큰 쪽을 택해요.
                  </div>
                </>
              )}
            </CalculatorCard>
            <CalculatorCard as="div" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2>입력 프리셋</h2>
              <PresetControls names={Object.keys(presets)} presetName={presetName} setPresetName={setPresetName}
                selectedName={presetSel} onSelect={name => { setPresetSel(name); if (name) applySnapshot(presets[name]); }}
                onSave={savePreset} onDelete={deletePreset} />
              <div style={{ fontSize: 11, color: C.sub }}>입력값은 이 브라우저에 자동 저장돼요 (새로고침해도 유지)</div>
            </CalculatorCard>
            <CalculatorCard as="div" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em" }}>재설정 비용 (메소, 수정 가능)</div>
              {[["epic", "에픽", C.epic], ["unique", "유니크", C.unique], ["legend", "레전드리", C.legend]].map(([k, lb, col]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, color: col, fontWeight: 600 }}>{lb}</span>
                  <input aria-label={`${lb} 재설정 비용 (메소)`} type="number" min="0" value={costs[k]} onChange={(e) => setCosts({ ...costs, [k]: e.target.value })}
                    style={{ ...inputStyle, width: 130, textAlign: "right" }} />
                </div>
              ))}
              <div style={{ fontSize: 11, color: C.sub }}>기본값: 2024.01 공식 표 ({level}제 구간)</div>
            </CalculatorCard>
          </aside>

          {/* 우측: 판매가 입력 */}
          <section className="calculator-results potential-results" aria-label="잠재능력 판매가와 계산 결과" aria-busy={busy}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.sub }}>
                판매가 입력값은 레벨·부위를 바꿔도 유지돼요 (레벨별 기준치 칸에 각각 저장)
              </span>
              <button onClick={clearAllPrices} style={{
                background: resetArm ? "rgba(242,122,106,.15)" : C.panel,
                border: `1px solid ${resetArm ? C.danger : C.border}`,
                color: resetArm ? C.danger : C.sub, borderRadius: 8, padding: "6px 12px",
                fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                fontWeight: resetArm ? 700 : 400, transition: "all .15s" }}>
                {resetArm ? "한 번 더 누르면 전체 삭제" : "입력한 판매가 일괄 초기화"}
              </button>
            </div>
            {part !== "glove" && (
              <CalculatorCard as="div" >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em" }}>
                    판매가 — 스탯 합계 (억 메소 · 빈칸 = 그 등급에선 판매 안 함)
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {[["u", "유니크 매물 가격", C.unique], ["l", "레전드리 매물 가격", C.legend]].map(([k, lb, col]) => (
                      <button key={k} aria-pressed={priceGrade === k} onClick={() => setPriceGrade(k)} style={{
                        background: priceGrade === k ? `${col}22` : C.panel2,
                        border: `1px solid ${priceGrade === k ? col : C.border}`,
                        color: priceGrade === k ? col : C.sub, borderRadius: 8, padding: "5px 12px",
                        fontSize: 12, fontWeight: priceGrade === k ? 700 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                        {lb}
                      </button>
                    ))}
                    <button onClick={copyPricesToOther} title="현재 탭의 가격을 다른 등급 탭에 덮어씀" style={{
                      background: "none", border: `1px solid ${C.border}`, color: C.sub, borderRadius: 8,
                      padding: "5px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                      → {priceGrade === "u" ? "레전" : "유니크"} 탭에 복사
                    </button>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                    <thead><tr>
                      <th style={{ textAlign: "left", color: C.sub, padding: 4 }}></th>
                      {thresholds.map((t) => <th key={t} style={{ color: C.sub, fontWeight: 600, padding: 4 }}>{t}%↑</th>)}
                    </tr></thead>
                    <tbody>
                      {[...STATS, "HP"].map((st) => (
                        <tr key={st}>
                          <td style={{ padding: 4, color: st === "HP" ? "#e58fb1" : C.text, fontWeight: 600 }}>{st === "HP" ? "MaxHP" : st}</td>
                          {thresholds.map((th) => (
                            <td key={th} style={{ padding: 2, textAlign: "center" }}>
                              <Num label={`${priceGrade === "u" ? "유니크" : "레전드리"} ${st} ${th}% 판매가 (억 메소)`} w={62} value={statPrices[`${priceGrade}:${st}_${th}`] ?? ""} ph="—"
                                onChange={(v) => setStatPrices((s) => ({ ...s, [`${priceGrade}:${st}_${th}`]: v }))} />
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px 4px 4px", color: "#8fd3e5", fontWeight: 600, whiteSpace: "nowrap" }}>올스탯</td>
                        {thresholds.map((_, i) => (
                          <td key={i} style={{ padding: "6px 2px 2px", verticalAlign: "bottom" }}>
                            {i < allThresholds.length ? (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                <span style={{ fontSize: 10, color: "#8fd3e5" }}>{allThresholds[i]}%↑</span>
                                <Num label={`${priceGrade === "u" ? "유니크" : "레전드리"} 올스탯 ${allThresholds[i]}% 판매가 (억 메소)`} w={62} value={statPrices[`${priceGrade}:ALL_${allThresholds[i]}`] ?? ""} ph="—"
                                  onChange={(v) => setStatPrices((s) => ({ ...s, [`${priceGrade}:ALL_${allThresholds[i]}`]: v }))} />
                              </div>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>
                  {priceGrade === "u" ? "유니크 등급 매물" : "레전드리 등급 매물"} 기준 시세를 입력하세요 — 같은 24%라도 등급에 따라 시세가 달라 따로 받아요 ·
                  매물 수치가 속한 구간(기준치 이상 ~ 같은 행의 다음 입력 기준치 미만)의 가격으로 판매 · 여러 행 동시 충족 시 최고가 적용 · MaxHP엔 올스탯 미합산 ·
                  올스탯 행은 올스탯% 줄만의 합계(제논용, 단일 스탯 줄 미포함)이라 기준치가 달라요
                </div>
              </CalculatorCard>
            )}
            {(part === "hat" || part === "glove") && (
              <CalculatorCard as="div" >
                <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em", marginBottom: 8 }}>
                  {part === "hat" ? "모자 특수 잠재 (쿨감, 레전드리 전용)" : "장갑 특수 잠재 (크뎀, 레전드리 전용)"}
                </div>
                {(part === "hat" ? hatRows : gloveRows).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    {part === "hat" ? (
                      <select aria-label={`모자 ${i + 1}번 조합의 쿨감 (초)`} value={r.cd} onChange={(e) => setHatRows(hatRows.map((x, k) => k === i ? { ...x, cd: +e.target.value } : x))} style={{ ...inputStyle, width: 110 }}>
                        {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>쿨감 {n}초↑</option>)}
                      </select>
                    ) : (
                      <select aria-label={`장갑 ${i + 1}번 조합의 크리티컬 데미지 (%)`} value={r.crit} onChange={(e) => setGloveRows(gloveRows.map((x, k) => k === i ? { ...x, crit: +e.target.value } : x))} style={{ ...inputStyle, width: 110 }}>
                        {[8, 16, 24].map((n) => <option key={n} value={n}>크뎀 {n}%↑</option>)}
                      </select>
                    )}
                    <select aria-label={`${part === "hat" ? "모자" : "장갑"} ${i + 1}번 조합의 최소 스탯 (%)`} value={r.statMin}
                      onChange={(e) => (part === "hat" ? setHatRows(hatRows.map((x, k) => k === i ? { ...x, statMin: +e.target.value } : x))
                        : setGloveRows(gloveRows.map((x, k) => k === i ? { ...x, statMin: +e.target.value } : x)))}
                      style={{ ...inputStyle, width: 130 }}>
                      {[...new Set([...statMinOpts, r.statMin])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m === 0 ? "스탯 무관" : `+ 스탯 ${m}%↑`}</option>)}
                    </select>
                    {r.statMin > 0 && (
                      <select aria-label={`${part === "hat" ? "모자" : "장갑"} ${i + 1}번 조합의 주스탯`} value={r.stat || "STR"}
                        onChange={(e) => (part === "hat" ? setHatRows(hatRows.map((x, k) => k === i ? { ...x, stat: e.target.value } : x))
                          : setGloveRows(gloveRows.map((x, k) => k === i ? { ...x, stat: e.target.value } : x)))}
                        style={{ ...inputStyle, width: 76 }}>
                        {STATS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    <Num label={`${part === "hat" ? "모자" : "장갑"} ${i + 1}번 조합의 판매가 (억 메소)`} w={80} value={r.price} ph="가격(억)"
                      onChange={(v) => (part === "hat" ? setHatRows(hatRows.map((x, k) => k === i ? { ...x, price: v } : x))
                        : setGloveRows(gloveRows.map((x, k) => k === i ? { ...x, price: v } : x)))} />
                    <button aria-label={`${part === "hat" ? "모자" : "장갑"} ${i + 1}번 조합 삭제`} onClick={() => (part === "hat" ? setHatRows(hatRows.filter((_, k) => k !== i)) : setGloveRows(gloveRows.filter((_, k) => k !== i)))}
                      style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 14 }}>✕</button>
                  </div>
                ))}
                <button onClick={() => (part === "hat" ? setHatRows([...hatRows, { cd: 2, statMin: 0, stat: "STR", price: "" }]) : setGloveRows([...gloveRows, { crit: 8, statMin: 0, stat: "STR", price: "" }]))}
                  style={{ ...inputStyle, width: "auto", cursor: "pointer", color: C.accent }}>+ 조합 추가</button>
              </CalculatorCard>
            )}
            {part === "acc" && (
              <CalculatorCard as="div" >
                <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em", marginBottom: 8 }}>
                  장신구 드메 잠재 (레전드리 전용, 줄당 20%)
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {[["drop2", "드랍 2줄↑"], ["meso2", "메획 2줄↑"], ["dropmeso", "드랍+메획 각1줄↑"], ["dm3", "드메 합 3줄"]].map(([k, lb]) => (
                    <label key={k} style={{ fontSize: 12, color: C.sub }}>{lb}
                      <Num w={90} value={accPrices[k]} ph="가격(억)" onChange={(v) => setAccPrices({ ...accPrices, [k]: v })} />
                    </label>
                  ))}
                </div>
              </CalculatorCard>
            )}

            {/* 결과 */}
            <CalculateButton disabled={!targets.u.length && !targets.l.length}
              onClick={() => setRecalculate(value => value + 1)}>장사 기대 수익 계산<span aria-hidden="true">→</span></CalculateButton>
            <p className="calculator-status" role="status" aria-live="polite">{progress}</p>
            {!result && (
              <CalculatorCard as="div" style={{ background: C.panel, border: `1px dashed ${C.border}`, borderRadius: 10, padding: 24, textAlign: "center", color: C.sub, fontSize: 13 }}>
                {busy ? "판매 정책과 기대 수익을 계산하고 있습니다" : "판매가를 1개 이상 입력하면 계산이 시작됩니다"}
              </CalculatorCard>
            )}
            {result && result.error && (
              <CalculatorCard as="div" role="alert" style={{ background: C.panel, border: `1px solid ${C.danger}`, borderRadius: 10, padding: 16, color: C.danger, fontSize: 12 }}>
                계산 오류: {result.error}
              </CalculatorCard>
            )}
            {eng && (
              <>
                {result.campaignWarning && <p className="potential-note" role="status">천장 소모까지 반복: {result.campaignWarning} 단일 라운드와 장기 평균은 아래에 표시합니다.</p>}
                {eng.legMode === "A" && (
                  <div style={{ background: "rgba(242,199,68,.08)", border: `1px solid rgba(242,199,68,.4)`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.unique }}>
                    활성 레전드리 종료조건이 없어, 레전드리 도달 시 깡통 처분가({fmtMeso((parseFloat(floorEok) || 0) * 1e8)})로 즉시 판매한다고 가정했어요.
                  </div>
                )}
                {eng.legMode === "C" && (
                  <div style={{ background: "rgba(121,224,125,.08)", border: `1px solid rgba(121,224,125,.35)`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.legend }}>
                    깡통 처분가({fmtMeso((parseFloat(floorEok) || 0) * 1e8)})가 재설정 지속보다 이득이라, 레전드리 도달 즉시 판매(타겟 뜨면 타겟가)하는 정책으로 계산했어요.
                  </div>
                )}
                {eng.legMode === "P" && eng.l1 && (
                  <div style={{ background: "rgba(94,200,242,.08)", border: `1px solid rgba(94,200,242,.4)`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.prime, lineHeight: 1.6 }}>
                    <b>프라임 모드</b> · 1줄 <b>{eng.l1.fixedLabel}</b> 고정 · 레전 도달 후 프라임 진입 확률 <b>{fmtPct(eng.l1.pEnter)}</b>
                    (나머지는 유효 옵션 판매{eng.legHitFloor ? "·깡통 처분" : ""}) · 진입 시 프라임 기대 <b>{eng.l1.avgPrimeRolls.toFixed(1)}회</b>
                    ({fmtMeso(eng.l1.avgPrimeRolls * (parseFloat(primeCostEok) || 0) * 1e8)})
                    {result.base && (
                      <> · 프라임 미사용 시 재설정 1회당 이득 <b style={{ color: C.text }}>{(result.base.steady.profit >= 0 ? "+" : "") + fmtMeso(result.base.steady.profit / Math.max(result.base.steady.resets, 1e-9))}</b>
                      → 프라임 사용 시 <b style={{ color: eng.steady.profit / eng.steady.resets >= result.base.steady.profit / result.base.steady.resets ? C.ok : C.danger }}>
                      {(eng.steady.profit >= 0 ? "+" : "") + fmtMeso(eng.steady.profit / Math.max(eng.steady.resets, 1e-9))}</b>
                      (라운드당 {(result.base.steady.profit >= 0 ? "+" : "") + fmtMeso(result.base.steady.profit)} → {(eng.steady.profit >= 0 ? "+" : "") + fmtMeso(eng.steady.profit)})</>
                    )}
                  </div>
                )}
                {primeOn && eng.legMode !== "P" && (
                  <div style={{ background: "rgba(242,199,68,.08)", border: `1px solid rgba(242,199,68,.4)`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.unique }}>
                    프라임 모드가 켜져 있지만 레전드리 타겟이 없어 프라임 단계를 계산하지 않았어요 (레전드리 매물 가격을 입력하세요).
                  </div>
                )}
                {sr && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["single", "단일 라운드"], ["campaign", "천장 소모까지 반복"]].map(([k, lb]) => (
                      <button key={k} aria-pressed={pm === k} disabled={k === "campaign" && !result.camp} onClick={() => setPityMode(k)} style={{
                        background: pm === k ? "rgba(255,157,77,.15)" : C.panel,
                        border: `1px solid ${pm === k ? C.accent : C.border}`,
                        color: pm === k ? C.accent : C.sub, borderRadius: 8, padding: "6px 14px",
                        fontSize: 12, fontWeight: pm === k ? 700 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                        {lb}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  {[
                    ["재설정 1회당 기대 이득", disp.profit / disp.resets, true],
                    [sr ? (pm === "campaign" ? "천장 소모까지 기대 순익" : `이번 라운드 기대 순익 (천장 ${result.j0} 반영)`) : "라운드당 기대 순익 (장기)", disp.profit, true],
                    [sr ? (pm === "campaign" ? "천장 소모까지 기대 재설정" : "이번 라운드 기대 재설정") : "라운드당 기대 재설정", disp.resets, false],
                    ["손익분기 노작 매입가", disp.breakeven, null],
                  ].map(([lb, v, money]) => (
                    <div key={lb} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>{lb}</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: money === true ? (v >= 0 ? C.ok : C.danger) : C.text }}>
                        {money === false ? v.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "회"
                          : (money === true && v >= 0 ? "+" : "") + fmtMeso(v)}
                      </div>
                    </div>
                  ))}
                </div>
                {sr ? (
                  <CalculatorCard as="div" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.sub }}>
                    {pm === "campaign" ? (
                      <>천장 {result.j0}스택을 <b style={{ color: C.text }}>레전드리 도달로 소모할 때까지 라운드 반복</b> 기준입니다 ·
                      기대 매물 수 {result.camp.rounds.toFixed(2)}개 · 장기 평균(스택 평형): 라운드당 <b style={{ color: eng.steady.profit >= 0 ? C.ok : C.danger }}>
                      {(eng.steady.profit >= 0 ? "+" : "") + fmtMeso(eng.steady.profit)}</b> / {eng.steady.resets.toFixed(1)}회</>
                    ) : (
                      <>천장 {result.j0}스택을 반영한 <b style={{ color: C.text }}>단일 라운드 기준</b>입니다 · 장기 평균(스택 평형): 라운드당 <b style={{ color: eng.steady.profit >= 0 ? C.ok : C.danger }}>
                      {(eng.steady.profit >= 0 ? "+" : "") + fmtMeso(eng.steady.profit)}</b> / {eng.steady.resets.toFixed(1)}회 ·
                      재진입 비용(매입가+에픽 {eng.epicRolls.toFixed(1)}회): {fmtMeso(eng.reentry)}</>
                    )}
                  </CalculatorCard>
                ) : (
                  <CalculatorCard as="div" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.sub }}>
                    현재 천장 {result.j0}회 기준 첫 라운드: 순익 <b style={{ color: result.first.profit >= 0 ? C.ok : C.danger }}>
                    {(result.first.profit >= 0 ? "+" : "") + fmtMeso(result.first.profit)}</b> · 재설정 {result.first.resets.toFixed(1)}회 ·
                    투입 {fmtMeso(result.first.cost)} · 재진입 비용(매입가+에픽 {eng.epicRolls.toFixed(1)}회): {fmtMeso(eng.reentry)}
                  </CalculatorCard>
                )}

                {/* 타겟 판정 */}
                <CalculatorCard as="div" className="potential-judgements" >
                  <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em", marginBottom: 8 }}>타겟별 판매/홀드 판정</div>
                  <div className="potential-table-scroll"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ color: C.sub }}>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>타겟</th>
                      <th style={{ textAlign: "center", padding: "4px 6px" }}>유니크에서 (구간 · 가격 · 판정 · 확률/회)</th>
                      <th style={{ textAlign: "center", padding: "4px 6px" }}>레전드리에서 (구간 · 가격 · 판정 · 확률/회)</th>
                      {eng.prime && <th style={{ textAlign: "center", padding: "4px 6px", color: C.prime }}>프라임에서 (보유 시 판정 · 확률/회)</th>}
                    </tr></thead>
                    <tbody>
                      {rowIds.map((id) => {
                        const row = byId[id]; const j = judgedMap[id] || {};
                        const cell = (tg, jg, prob, holdLabel) => tg ? (
                          <>
                            <div style={{ fontSize: 10, color: C.sub, marginBottom: 3 }}>{tg.range || "—"} · {fmtMeso(tg.price)}</div>
                            {jg === null || jg === undefined ? <Badge kind="na">도달 불가</Badge>
                              : jg ? <Badge kind="sell">판매</Badge> : <Badge kind="hold">{holdLabel}</Badge>}
                            <div style={{ fontSize: 10, color: C.sub, marginTop: 3 }}>{prob > 1e-12 ? fmtPct(prob) : "—"}</div>
                          </>
                        ) : <span style={{ fontSize: 11, color: C.sub }}>가격 미입력</span>;
                        return (
                          <tr key={id}
                            style={{ borderTop: `1px solid ${C.border}`, cursor: "pointer",
                              background: hoverTid === id ? C.panel2 : "transparent" }}>
                            <td style={{ padding: "6px" }}><button className="potential-detail-toggle" aria-expanded={hoverTid === id} aria-controls={`potential-detail-${id}`} onClick={() => setHoverTid(hoverTid === id ? null : id)}>{row.base}<span aria-hidden="true"> {hoverTid === id ? '−' : '+'}</span></button></td>
                            <td style={{ padding: "6px", textAlign: "center" }}>{cell(row.u, j.u, eng.uProb[id] || 0, "홀드 · 재설정 이득")}</td>
                            <td style={{ padding: "6px", textAlign: "center" }}>{cell(row.l, j.l, eng.lProb[id] || 0, eng.legMode === "P" ? "홀드 · 재설정 계속" : "홀드 · 상위 노리기")}</td>
                            {eng.prime && (
                              <td style={{ padding: "6px", textAlign: "center" }}>
                                {row.l && eng.prime.idx[id] !== undefined ? (
                                  <>
                                    {eng.prime.sell[eng.prime.idx[id]] ? <Badge kind="sell">판매</Badge> : <Badge kind="hold">홀드 · 프라임 계속</Badge>}
                                    <div style={{ fontSize: 10, color: C.sub, marginTop: 3 }}>{(eng.prime.probById[id] || 0) > 1e-12 ? fmtPct(eng.prime.probById[id]) : "1줄 고정 시 도달 불가"}</div>
                                  </>
                                ) : <span style={{ fontSize: 11, color: C.sub }}>{row.l ? "도달 불가" : "가격 미입력"}</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table></div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>
                    구간은 등급별 입력 기준치 기준 · 확률은 해당 구간 도달 확률/회 · 타겟 버튼을 누르면 도달 가능한 옵션 조합별 확률을 보여줘요 ·
                    유니크 판정 기준: {(1 - result.cfg.fee / 100).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}×판매가 &gt; 재진입 비용 {fmtMeso(eng.reentry)} + 에픽 구간 재설정 {eng.epicRolls.toFixed(1)}회의 기회비용(회당 {fmtMeso(eng.gShift)}) = <b style={{ color: C.text }}>{fmtMeso(eng.reentryEff)}</b> —
                    천장은 캐릭터 귀속이라 팔아도 이월되지만, 팔고 다시 올라오는 동안의 재설정은 다른 매물에 썼다면 벌었을 시간이라 비용으로 칩니다 ·
                    레전드리 판정: 계속 재설정 시 기대 수익(큐브값+기회비용 반영)과 비교(최적 정지) · 자동 제외 정책은 재설정 1회당 기대 이득이 최대가 되는 고정점으로 수렴시킨 결과예요
                    {eng.prime && <> · 프라임 열: 1줄 고정 상태에서 그 타겟을 <b style={{ color: C.text }}>보유 중일 때</b> 판매할지(프라임 1회 더 = {fmtMeso((parseFloat(primeCostEok) || 0) * 1e8)}+기회비용) · 확률은 프라임 1회당 그 구간이 최고가로 뜰 확률 · 선택 적용이라 보유 옵션은 절대 나빠지지 않아요</>}
                  </div>
                  {hoverTid && byId[hoverTid] && (() => {
                    const row = byId[hoverTid];
                    const renderCombos = (m) => {
                      const es = Object.entries(m || {}).sort((a, b) => b[1] - a[1]);
                      if (!es.length) return <div style={{ fontSize: 11, color: C.sub }}>도달 조합 없음</div>;
                      const top = es.slice(0, 12); const restP = es.slice(12).reduce((s, [, p]) => s + p, 0);
                      return (
                        <>
                          {top.map(([k, p]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "2px 0" }}>
                              <span>{k}</span><span style={{ color: C.sub, whiteSpace: "nowrap" }}>{fmtPct(p)}</span>
                            </div>
                          ))}
                          {restP > 0 && <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>외 {es.length - 12}개 조합 — {fmtPct(restP)}</div>}
                        </>
                      );
                    };
                    return (
                      <div id={`potential-detail-${hoverTid}`} className="potential-combo-detail">
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{row.base} — 구간 도달 조합 (기타 = 미추적 옵션 아무거나)</div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 220px" }}>
                            <div style={{ fontSize: 11, color: C.unique, fontWeight: 700, marginBottom: 4 }}>
                              유니크 재설정 시{row.u?.range ? ` · 구간 ${row.u.range}` : ""} · 합 {row.u ? fmtPct(eng.uProb[hoverTid] || 0) : "가격 미입력"}
                            </div>
                            {row.u ? renderCombos(eng.uCombos[hoverTid]) : null}
                          </div>
                          <div style={{ flex: "1 1 220px" }}>
                            <div style={{ fontSize: 11, color: C.legend, fontWeight: 700, marginBottom: 4 }}>
                              레전드리 재설정 시{row.l?.range ? ` · 구간 ${row.l.range}` : ""} · 합 {row.l ? fmtPct(eng.lProb[hoverTid] || 0) : "가격 미입력"}
                            </div>
                            {row.l ? renderCombos(eng.lCombos[hoverTid]) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </CalculatorCard>

                {result.simulationWarning && <p className="potential-note" role="status">기대 수익은 정확 해석 결과입니다. 리스크 시뮬레이션: {result.simulationWarning}</p>}
                {/* 판매 구성 + 리스크 */}
                {result.mc && <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "var(--ui-card-padding, 22px)" }}>
                    <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em", marginBottom: 8 }}>
                      라운드 종료 구성 (시뮬레이션 {result.mc.rounds.toLocaleString()}라운드{sr ? (pm === "campaign" ? " · 천장 소모까지" : " · 현재 스택 시작") : ""})
                    </div>
                    {compEntries.map((e) => (
                      <div key={e.label} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span>{e.label}</span><span style={{ color: C.sub }}>{fmtPct(e.share)}</span>
                        </div>
                        <div style={{ height: 5, background: C.panel2, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${Math.max(1, e.share * 100)}%`, height: "100%", background: C.accent }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ flex: "1 1 220px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "var(--ui-card-padding, 22px)" }}>
                    <div style={{ fontSize: 16, color: C.text, fontWeight: 750, letterSpacing: "-.02em", marginBottom: 8 }}>라운드 순익 분포 (리스크{sr ? (pm === "campaign" ? " · 천장 소모까지" : " · 현재 스택 시작") : ""})</div>
                    {[["하위 10% (불운)", result.mc.p10], ["중앙값", result.mc.p50], ["상위 10% (행운)", result.mc.p90]].map(([lb, v]) => (
                      <div key={lb} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ color: C.sub }}>{lb}</span>
                        <span style={{ fontWeight: 700, color: v >= 0 ? C.ok : C.danger }}>{(v >= 0 ? "+" : "") + fmtMeso(v)}</span>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>
                      기댓값이 +여도 단기 편차가 큽니다. 회전 자금은 하위 10% 기준으로 준비하세요.
                    </div>
                  </div>
                </div>}
                <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
                  가정: 잠재능력 재설정(블랙큐브 동일 성능) · 에픽잠재부여주문서 비용 0 · 등업 롤은 새 등급 옵션으로 판정 ·
                  쓸만한 스킬(최대 1줄)/피격 무적류(최대 1~2줄) 재계산 규칙 반영 · "동일 결과 재출현 방지"는 생략(근사 범위는 모델 문서 참고) ·
                  미라클데이는 등급업 확률만 ×2 (천장 적립·옵션 확률 불변)
                  {primeOn && <> · 프라임 큐브: 옵션 확률 블랙큐브 동일(2줄 20%·3줄 5% 상위 등급) · 조각 가치 미반영 · 구매 제한 미반영</>}
                </div>
              </>
            )}
          </section>
      </div>
      <CalculatorFooter />
    </main>
  );
}
