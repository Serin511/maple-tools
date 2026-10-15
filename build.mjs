import { build } from 'esbuild';
const measurementId = (process.env.GA4_MEASUREMENT_ID || '').trim();
if (measurementId && !/^G-[A-Z0-9]+$/.test(measurementId)) {
  throw new Error('GA4_MEASUREMENT_ID must be a GA4 measurement ID such as G-XXXXXXXXXX, or empty to disable analytics.');
}
await build({entryPoints:['entry.jsx'],bundle:true,minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env.GA4_MEASUREMENT_ID':JSON.stringify(measurementId)},outfile:'bundle.js'});
await build({entryPoints:['ability-worker.mjs'],bundle:true,minify:true,format:'iife',outfile:'ability-worker.js'});
await build({entryPoints:['flame-worker.mjs'],bundle:true,minify:true,format:'iife',outfile:'flame-worker.js'});
await build({entryPoints:['additional-worker.mjs'],bundle:true,minify:true,format:'iife',outfile:'additional-worker.js'});
await build({entryPoints:['additional-trade-worker.mjs'],bundle:true,minify:true,format:'iife',outfile:'additional-trade-worker.js'});
await build({entryPoints:['potential-worker.mjs'],bundle:true,minify:true,format:'iife',outfile:'potential-worker.js'});
await import('./make_html.mjs');
