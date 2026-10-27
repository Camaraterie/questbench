#!/usr/bin/env bun
/**
 * Snapshot a running Studio into one static HTML file (data embedded), for sharing a preview.
 *   bun studio/build-demo.ts http://localhost:4747 <run-id> > studio-preview.html
 */
const [base = 'http://localhost:4747', runId] = process.argv.slice(2);
const get = async (p: string) => (await fetch(base + p)).json();
const runs = await get('/api/runs');
const data = { live: await get('/api/live'), runs, detail: runId ? await get(`/api/runs/${runId}`) : runs[0] ? await get(`/api/runs/${runs[0].id}`) : null, preflight: await get('/api/preflight') };
const html = await Bun.file(new URL('./index.html', import.meta.url)).text();
process.stdout.write(html.replace('<script>\nconst DEMO', `<script>window.QB_DEMO=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>\n<script>\nconst DEMO`));
