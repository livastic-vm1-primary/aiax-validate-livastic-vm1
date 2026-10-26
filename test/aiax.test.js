import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateSite } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixture = name => path.join(root, 'fixtures', name);
const cli = path.join(root, 'bin', 'aiax-validate.js');

async function responseFromFixtures(dir) {
  return async input => {
    const u = new URL(String(input));
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const full = path.resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + path.sep)) return new Response('forbidden', { status: 403 });
    try { return new Response(await (await import('node:fs/promises')).readFile(full), { status: 200 }); }
    catch { return new Response('missing', { status: 404 }); }
  };
}

test('A1: valid website manifest and section pass with score >= 90 (offline fixture)', async () => {
  const report = await validateSite('https://fixture.test', { fetch: await responseFromFixtures(fixture('A1-valid')) });
  assert.equal(report.ok, true);
  assert.ok(report.score >= 90);
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].id, 'hello');
  assert.deepEqual(report.errors, []);
});

test('A2: each broken manifest schema field becomes a field-specific error', async () => {
  const report = await validateSite('https://fixture.test', { fetch: await responseFromFixtures(fixture('A2-broken-manifest')) });
  assert.equal(report.ok, false);
  const messages = report.errors.map(e => e.message).join('\n');
  for (const field of ['aiax_version', 'product', 'unexpected', 'id', 'est_tokens', 'score', 'updated_at', 'oops']) assert.match(messages, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(report.score < 90);
});

test('A3: invalid pricing, empty examples and mismatched section_id are explained', async () => {
  const report = await validateSite('https://fixture.test', { fetch: await responseFromFixtures(fixture('A3-broken-section')) });
  assert.equal(report.ok, false);
  const messages = report.errors.map(e => e.message).join('\n');
  assert.match(messages, /amount/);
  assert.match(messages, /Unexpected field.*extra/);
  assert.match(messages, /examples/);
  assert.match(messages, /does not match manifest entry point id/);
});

test('A3: missing section and non-JSON section produce explicit errors', async () => {
  const base = {
    aiax_version: '0.1', product: { name: 'Test', one_line_purpose: 'Test', domain: 'test' },
    entry_points: [
      { id: 'missing', url: '/missing.json', purpose: 'Missing', est_tokens: 1 },
      { id: 'not_json', url: '/not-json.json', purpose: 'Not JSON', est_tokens: 1 }
    ], pricing_summary: 'free', trust_signals: {}, mcp_endpoint: null, updated_at: '2026-10-26T00:00:00Z'
  };
  const fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === '/.well-known/aiax.json') return Response.json(base);
    if (url.pathname === '/aiax/manifest.json') return new Response('missing', { status: 404 });
    if (url.pathname === '/not-json.json') return new Response('oops', { status: 200 });
    return new Response('missing', { status: 404 });
  };
  const report = await validateSite('https://fixture.test', { fetch });
  assert.match(report.errors.map(e => e.message).join('\n'), /HTTP 404/);
  assert.match(report.errors.map(e => e.message).join('\n'), /not valid JSON/);
});

test('A4: JSON output and CLI exit codes 0, 1 and 2', async () => {
  const ok = spawnSync(process.execPath, [cli, 'https://fixture.test', '--fixtures', fixture('A1-valid'), '--json'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).score, 100);
  const bad = spawnSync(process.execPath, [cli, 'https://fixture.test', '--fixtures', fixture('A2-broken-manifest'), '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1, bad.stderr);
  assert.equal(JSON.parse(bad.stdout).ok, false);
  const usage = spawnSync(process.execPath, [cli, '--json'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);
});

test('A5: package has executable bin and fixtures for valid and broken cases', async () => {
  const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.bin['aiax-validate'], './bin/aiax-validate.js');
  assert.equal(pkg.engines.node, '>=20');
  for (const rel of ['manifest.schema.json', 'section.schema.json']) await access(path.join(root, 'schemas', rel));
  for (const rel of ['A1-valid/.well-known/aiax.json', 'A1-valid/aiax/sections/hello.json', 'A2-broken-manifest/.well-known/aiax.json', 'A3-broken-section/.well-known/aiax.json', 'A3-broken-section/aiax/sections/broken.json']) await access(path.join(root, 'fixtures', rel));
});

test('A1-live: Kognai endpoints pass (opt-in network acceptance check)', { skip: process.env.AIAX_LIVE_TEST !== '1' }, async () => {
  for (const site of ['https://lax.kognai.ai', 'https://www.kognai.ai']) {
    const report = await validateSite(site);
    assert.ok(report.ok, `${site}: ${JSON.stringify(report.errors.slice(0, 10))}`);
    assert.ok(report.score >= 90, `${site}: ${report.score}`);
  }
});
