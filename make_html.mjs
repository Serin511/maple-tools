import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { SITE_TITLE, SITE_DESCRIPTION, SITE_PREVIEW, CALCULATOR_PAGES } from "./calculator-pages.mjs";
const siteOrigin = `https://${readFileSync("CNAME", "utf8").trim()}`;
const js = readFileSync("bundle.js", "utf8");
const css = readFileSync("bundle.css", "utf8");
const worker = JSON.stringify(readFileSync("ability-worker.js", "utf8")).replace(/</g, "\\u003c");
const flameWorker = JSON.stringify(readFileSync("flame-worker.js", "utf8")).replace(/</g, "\\u003c");
const additionalWorker = JSON.stringify(readFileSync("additional-worker.js", "utf8")).replace(/</g, "\\u003c");
const additionalTradeWorker = JSON.stringify(readFileSync("additional-trade-worker.js", "utf8")).replace(/</g, "\\u003c");
const flameTradeWorker = JSON.stringify(readFileSync("flame-trade-worker.js", "utf8")).replace(/</g, "\\u003c");
const potentialWorker = JSON.stringify(readFileSync("potential-worker.js", "utf8")).replace(/</g, "\\u003c");
const makeHtml = ({ id, title, description }) => {
  const pageUrl = id === "home" ? `${siteOrigin}/` : `${siteOrigin}/${id}/`;
  const imageUrl = `${siteOrigin}/og/${id}.png`;
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="canonical" href="${pageUrl}" />
<title>${escapeHtml(title === SITE_TITLE ? "확률과 효율 계산" : title)} | ${escapeHtml(SITE_TITLE)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:alt" content="${escapeHtml(title)} 미리보기" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(SITE_TITLE)}" />
<meta property="og:locale" content="ko_KR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${imageUrl}" />
<meta name="twitter:image:alt" content="${escapeHtml(title)} 미리보기" />
<style>html,body{margin:0;padding:0;background:#12151b}#root{min-height:100vh}${css}</style>
</head>
<body>
<div id="root"></div>
<script id="ability-worker-source" type="application/json">${worker}</script>
<script id="flame-worker-source" type="application/json">${flameWorker}</script>
<script id="additional-worker-source" type="application/json">${additionalWorker}</script>
<script id="additional-trade-worker-source" type="application/json">${additionalTradeWorker}</script>
<script id="flame-trade-worker-source" type="application/json">${flameTradeWorker}</script>
<script id="potential-worker-source" type="application/json">${potentialWorker}</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
  return html;
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

mkdirSync("dist", { recursive: true });
mkdirSync("dist/og", { recursive: true });
const outputPages = [{ ...SITE_PREVIEW, id: "home", title: SITE_TITLE, description: SITE_DESCRIPTION }, ...CALCULATOR_PAGES];
for (const page of outputPages) {
  const image = `public/og/${page.id}.png`;
  if (!existsSync(image)) throw new Error(`Missing Open Graph preview image: ${image}. Run node generate-previews.mjs first.`);
  copyFileSync(image, `dist/og/${page.id}.png`);
}
for (const page of outputPages) {
  const html = makeHtml(page);
  const outputDir = page.id === "home" ? "dist" : `dist/${page.id}`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(`${outputDir}/index.html`, html);
  console.log(`${outputDir}/index.html:`, html.length, "bytes");
}
copyFileSync("CNAME", "dist/CNAME");
