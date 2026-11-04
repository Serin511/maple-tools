import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { SITE_TITLE, SITE_DESCRIPTION, SITE_PREVIEW, CALCULATOR_PAGES } from "./calculator-pages.mjs";

const OUTPUT_DIR = "public/og";
const WIDTH = 1200;
const HEIGHT = 630;
const pages = [
  { ...SITE_PREVIEW, id: "home", title: SITE_PREVIEW.title || SITE_TITLE, description: SITE_PREVIEW.description || SITE_DESCRIPTION },
  ...CALCULATOR_PAGES,
];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function makePreview({ title, description, accent, id }, index) {
  const safeAccent = /^#[0-9a-f]{3,8}$/i.test(accent || "") ? accent : "#ff9f56";
  const shortDescription = description || "공식 확률과 시세를 바탕으로 빠르고 편하게 계산해 보세요.";
  const ordinal = String(index).padStart(2, "0");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","AppleGothic",sans-serif;color:#f2f5fa;background:#11151c}
.canvas{width:${WIDTH}px;height:${HEIGHT}px;position:relative;overflow:hidden;padding:49px 64px;background:radial-gradient(ellipse at 83% 43%,color-mix(in srgb,${safeAccent} 17%,transparent),transparent 38%),linear-gradient(135deg,#151a22,#10141b 63%,#161a21)}
.grid{position:absolute;inset:0;opacity:.19;background-image:linear-gradient(rgba(149,164,185,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(149,164,185,.12) 1px,transparent 1px);background-size:40px 40px;mask-image:linear-gradient(90deg,black,transparent 92%)}
.glow{position:absolute;width:510px;height:510px;right:-174px;top:63px;border-radius:50%;border:1px solid color-mix(in srgb,${safeAccent} 20%,transparent);box-shadow:0 0 0 48px color-mix(in srgb,${safeAccent} 4%,transparent),0 0 0 96px color-mix(in srgb,${safeAccent} 3%,transparent)}
.top,.content,.footer{position:relative;z-index:1}.top{display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:13px}.leaf{width:39px;height:39px;display:grid;place-items:center;border:1px solid color-mix(in srgb,${safeAccent} 48%,#313945);border-radius:12px;background:color-mix(in srgb,${safeAccent} 12%,#191e26)}.leaf svg{width:24px;height:24px;fill:${safeAccent}}.brand-name{font-size:17px;font-weight:760;letter-spacing:-.04em}.brand-sub{margin-top:3px;color:#8490a0;font-size:10px;letter-spacing:.16em;font-weight:650}.top-note{padding:9px 13px;border:1px solid #303946;border-radius:99px;color:#aeb8c6;font-size:11px;letter-spacing:.025em;background:#171c24c9}.top-note i{display:inline-block;width:6px;height:6px;margin:0 7px 1px 0;border-radius:100%;background:${safeAccent};box-shadow:0 0 9px ${safeAccent}}
.content{width:790px;margin-top:65px}.kicker{display:flex;align-items:center;gap:10px;color:${safeAccent};font-size:11px;font-weight:760;letter-spacing:.19em;text-transform:uppercase}.kicker:before{content:"";width:23px;height:1px;background:${safeAccent};opacity:.8}.title{max-width:790px;margin:18px 0 15px;font-size:70px;line-height:1.18;letter-spacing:-.065em;font-weight:820;word-break:keep-all;overflow-wrap:anywhere}.title.home{font-size:78px}.summary{width:670px;margin:0;color:#aab4c2;font-size:19px;line-height:1.62;letter-spacing:-.025em;word-break:keep-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.footer{position:absolute;left:64px;right:64px;bottom:38px;display:flex;align-items:center;justify-content:space-between;color:#727e8e;font-size:11px;letter-spacing:.08em}.url{color:#a6b0bd;letter-spacing:.025em}.badge{display:flex;align-items:center;gap:9px}.badge span{color:${safeAccent};font-weight:760}.badge b{width:4px;height:4px;border-radius:9px;background:#4a5564}.visual{position:absolute;right:75px;top:194px;width:257px;height:198px;padding:17px 17px 15px;border-radius:16px;border:1px solid #343e4c;background:linear-gradient(145deg,rgba(34,41,52,.92),rgba(23,28,37,.87));box-shadow:0 18px 55px #05070b55;transform:rotate(2deg)}.visual-head{display:flex;align-items:center;justify-content:space-between;color:#adb8c7;font-size:10px}.visual-head strong{color:#f0f3f8;font-size:11px}.dots{display:flex;gap:4px}.dots i{width:5px;height:5px;border-radius:50%;background:#536071}.metric{display:flex;align-items:end;justify-content:space-between;margin-top:20px}.metric small{color:#8793a3;font-size:10px}.metric b{color:${safeAccent};font-size:25px;letter-spacing:-.045em}.chart{height:61px;display:flex;align-items:end;gap:7px;margin-top:8px;padding:0 2px 7px;border-bottom:1px solid #3c4653}.chart i{flex:1;border-radius:4px 4px 1px 1px;background:linear-gradient(180deg,${safeAccent},color-mix(in srgb,${safeAccent} 31%,#36404d));opacity:.88}.chart i:nth-child(1){height:25%}.chart i:nth-child(2){height:35%}.chart i:nth-child(3){height:31%}.chart i:nth-child(4){height:52%}.chart i:nth-child(5){height:49%}.chart i:nth-child(6){height:72%}.chart i:nth-child(7){height:65%}.chart i:nth-child(8){height:95%}.ticks{display:flex;justify-content:space-between;margin-top:7px;color:#778392;font-size:8px}.result{position:absolute;right:55px;top:420px;width:185px;padding:13px 15px;border:1px solid color-mix(in srgb,${safeAccent} 39%,#303946);border-radius:11px;background:#1a2029;box-shadow:0 12px 28px #07090d70;transform:rotate(-2deg)}.result small{display:block;color:#8591a0;font-size:9px}.result b{display:block;margin-top:5px;color:#e7edf5;font-size:16px}.result b em{color:${safeAccent};font-style:normal}
</style></head><body><div class="canvas"><div class="grid"></div><div class="glow"></div>
<header class="top"><div class="brand"><div class="leaf"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 14.1 7l5.4-2-2.1 5.2 5.2 2.1-5.2 2.1 2.1 5.2-5.4-2L12 22.8l-2.1-5.2-5.4 2 2.1-5.2-5.2-2.1 5.2-2.1-2.1-5.2 5.4 2z"/><path d="m7.4 16.5 9.2-9.1M11.6 12.5 8.7 9.7m5.1-.5 2.8 2.8" fill="none" stroke="#181d24" stroke-width="1.15" stroke-linecap="round"/></svg></div><div><div class="brand-name">${escapeHtml(SITE_TITLE)}</div><div class="brand-sub">MAPLE TOOLS · CALCULATOR</div></div></div><div class="top-note"><i></i>공식 확률표 기반 · 빠른 계산</div></header>
<main class="content"><div class="kicker">${escapeHtml(id === "home" ? "MAPLE CALCULATOR" : "CALCULATOR / " + ordinal)}</div><h1 class="title ${id === "home" ? "home" : ""}">${escapeHtml(title)}</h1><p class="summary">${escapeHtml(shortDescription)}</p></main>
<aside class="visual"><div class="visual-head"><strong>계산 리포트</strong><span class="dots"><i></i><i></i><i></i></span></div><div class="metric"><small>항목별 분석</small><b>전략 비교</b></div><div class="chart"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="ticks"><span>조건</span><span>비교</span><span>분석</span></div></aside><aside class="result"><small>계산 기준</small><b>조건별 결과 비교 <em>↗</em></b></aside>
<footer class="footer"><span class="url">maple-tools.celia.moe</span><span class="badge"><span>CALCULATE</span><b></b>COMPARE<b></b>OPTIMIZE</span></footer></div><script>document.fonts.ready.then(()=>{const t=document.querySelector('.title');let size=getComputedStyle(t).fontSize;let n=parseFloat(size);while((t.scrollHeight>174||t.scrollWidth>790)&&n>48){n-=1;t.style.fontSize=n+'px'}})</script></body></html>`;
}

await mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  for (let index = 0; index < pages.length; index += 1) {
    const item = pages[index];
    await page.setContent(makePreview(item, index), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUTPUT_DIR}/${item.id}.png`, type: "png" });
    console.log(`Generated ${OUTPUT_DIR}/${item.id}.png (${WIDTH}x${HEIGHT})`);
  }
} finally {
  await browser.close();
}
