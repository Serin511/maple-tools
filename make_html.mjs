import { readFileSync, writeFileSync, mkdirSync } from "fs";
const js = readFileSync("bundle.js", "utf8");
const css = readFileSync("bundle.css", "utf8");
const worker = JSON.stringify(readFileSync("ability-worker.js", "utf8")).replace(/</g, "\\u003c");
const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>메이플 계산기 · 잠재능력과 어빌리티</title>
<meta name="description" content="메이플스토리 잠재능력 장사 수익과 어빌리티 목표 세트별 최적 재설정 전략 · 공식 확률표 기반" />
<style>html,body{margin:0;padding:0;background:#12151b}#root{min-height:100vh}${css}</style>
</head>
<body>
<div id="root"></div>
<script id="ability-worker-source" type="application/json">${worker}</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log("dist/index.html:", html.length, "bytes");
