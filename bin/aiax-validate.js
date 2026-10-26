#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { validateSite } from '../src/index.js';

function usage() {
  process.stderr.write('Usage: aiax-validate <url> [--json] [--fixtures <dir>]\n');
  process.exit(2);
}
const args = process.argv.slice(2);
let url; let json = false; let fixturesDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') { json = true; continue; }
  if (args[i] === '--fixtures') { if (!args[i + 1]) usage(); fixturesDir = path.resolve(args[++i]); continue; }
  if (args[i].startsWith('-') || url !== undefined) usage();
  url = args[i];
}
if (!url) usage();
let fixtureFetch;
if (fixturesDir) {
  fixtureFetch = async (input) => {
    const u = new URL(String(input));
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.resolve(fixturesDir, rel);
    if (file !== fixturesDir && !file.startsWith(fixturesDir + path.sep)) return new Response('Forbidden', { status: 403 });
    try { return new Response(await readFile(file), { status: 200, headers: { 'content-type': 'application/json' } }); }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'EISDIR') return new Response('Not found', { status: 404 }); throw e; }
  };
}
try {
  const report = await validateSite(url, fixtureFetch ? { fetch: fixtureFetch } : {});
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    process.stdout.write(`${report.ok ? 'OK' : 'FAIL'} ${report.score}/100 ${report.url}\n`);
    for (const e of report.errors) process.stdout.write(`ERROR ${e.url} ${e.path} ${e.message}\n`);
    for (const w of report.warnings) process.stdout.write(`WARN ${w.url} ${w.path} ${w.message}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  process.stderr.write(`Validation failed unexpectedly: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
