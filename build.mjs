import { build } from 'esbuild';
await build({entryPoints:['entry.jsx'],bundle:true,minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},outfile:'bundle.js'});
await build({entryPoints:['ability-worker.mjs'],bundle:true,minify:true,format:'iife',outfile:'ability-worker.js'});
await import('./make_html.mjs');
