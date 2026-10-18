import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { acquireLock, releaseLock, initManifest, loadManifest, updateSpecStatus } from '../src/manifest.mjs';
import { runWizard } from '../src/wizard.mjs';
import { auditSpec } from '../src/auditor.mjs';

let dir;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'omnispec-stabilization-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
const pause = ms => new Promise(done => setTimeout(done, ms));
const manifestUrl = new URL('../src/manifest.mjs', import.meta.url).href;
const generatorUrl = new URL('../src/generator.mjs', import.meta.url).href;

const workerCode = `
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const { acquireLock, releaseLock } = await import(process.argv[1]);
const { createSpec } = await import(process.argv[2]);
const dir = process.argv[3], mode = process.argv[4];
process.send({ event: 'ready' });
process.once('message', async () => {
  try {
    if (mode === 'choosing') {
      const lock = join(dir, 'specs', 'manifest.lock');
      await mkdir(lock, { recursive: true });
      await mkdir(join(lock, process.pid + '-' + randomUUID()));
      process.send({ event: 'held' });
      setInterval(() => {}, 1000);
    } else if (mode === 'hold') {
      const lock = join(dir, 'specs', 'manifest.lock');
      const lease = await acquireLock(lock);
      process.send({ event: 'held' });
      process.once('message', async () => {
        await releaseLock(lock, lease);
        process.send({ event: 'done' }); process.disconnect();
      });
    } else {
      for (let i = 0; i < 3; i++) await createSpec(dir, 'feature', 'worker-' + process.pid + '-' + i);
      process.send({ event: 'done' }); process.disconnect();
    }
  } catch (error) { process.send({ event: 'failure', error: error.stack }); process.exitCode = 1; process.disconnect(); }
});
`;

function worker(t, mode) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', workerCode, manifestUrl, generatorUrl, dir, mode],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const events = new Map();
  child.on('message', message => events.set(message.event, message));
  child.on('error', error => events.set('failure', { error: error.message }));
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; });
  return {
    child, closed,
    async wait(event) {
      const deadline = Date.now() + 35000;
      while (!events.has(event)) {
        if (events.has('failure')) throw new Error(events.get('failure').error);
        if (Date.now() > deadline) throw new Error('Worker timeout: ' + event);
        await pause(10);
      }
    }
  };
}

async function interactive(t, flags = [], answers = []) {
  const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, 'init', ...flags], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; });
  const prompts = ['Project Name [', 'Select an option (1-8)', 'Preferred Documentation Standard [',
    'Select an option (1-5)', 'Quality Gates command(s) [', 'Proceed with scaffolding?'];
  let output = '', stderr = '', index = 0;
  const timer = setTimeout(() => child.kill(), 25000);
  child.stdout.on('data', data => {
    output += data;
    while (index < prompts.length && output.includes(prompts[index])) {
      child.stdin.write((answers[index++] || '') + '\n');
    }
  });
  child.stderr.on('data', data => { stderr += data; });
  const [code] = await closed; clearTimeout(timer);
  return { code, output, stderr, answered: index };
}

test('a living owner retains exclusion beyond the former 15-second expiration', { timeout: 35000 }, async t => {
  await scaffoldProject(dir, { projectName: 'LiveOwner' });
  const owner = worker(t, 'hold');
  await owner.wait('ready'); owner.child.send('start'); await owner.wait('held');
  await pause(15300);
  await assert.rejects(acquireLock(join(dir, 'specs', 'manifest.lock'), 2, 5), /Lock timeout/);
  owner.child.send('release'); await owner.wait('done'); await owner.closed;
  const spec = await createSpec(dir, 'feature', 'after-owner');
  assert.equal(spec.id, '001');
});

for (const mode of ['hold', 'choosing']) {
  test(`eight processes recover a dead ${mode} owner without lost entries`, { timeout: 45000 }, async t => {
    await scaffoldProject(dir, { projectName: 'Recovery' });
    const owner = worker(t, mode);
    await owner.wait('ready'); owner.child.send('start'); await owner.wait('held');
    owner.child.kill(); await owner.closed;
    const peers = Array.from({ length: 8 }, () => worker(t, 'create'));
    await Promise.all(peers.map(peer => peer.wait('ready')));
    for (const peer of peers) peer.child.send('start');
    await Promise.all(peers.map(peer => peer.wait('done')));
    const exits = await Promise.all(peers.map(peer => peer.closed));
    assert.ok(exits.every(([code]) => code === 0));
    const manifest = await loadManifest(dir);
    assert.equal(manifest.specs.length, 24);
    assert.equal(new Set(manifest.specs.map(spec => spec.id)).size, 24);
    assert.deepEqual(await readdir(join(dir, 'specs', 'manifest.lock')), []);
  });
}

test('only the acquiring lease can release its claim', async () => {
  await mkdir(join(dir, 'specs'));
  const lock = join(dir, 'specs', 'manifest.lock');
  const lease = await acquireLock(lock);
  await assert.rejects(releaseLock(lock, { ...lease }), /matching.*lease/);
  await assert.rejects(acquireLock(lock, 1, 1), /Lock timeout/);
  await releaseLock(lock, lease);
  const successor = await acquireLock(lock);
  await assert.rejects(releaseLock(lock, lease), /matching.*lease/);
  assert.equal((await readdir(lock)).length, 1);
  await releaseLock(lock, successor);
});

test('init, create and closure serialize without dropping records or statuses', async () => {
  await scaffoldProject(dir, { projectName: 'Mixed' });
  await createSpec(dir, 'feature', 'first');
  await Promise.all([
    ...Array.from({ length: 4 }, () => initManifest(dir)),
    ...Array.from({ length: 4 }, (_, i) => createSpec(dir, 'feature', 'task-' + i)),
    updateSpecStatus(dir, '001', 'CLOSED')
  ]);
  const manifest = await loadManifest(dir);
  assert.equal(manifest.specs.length, 5);
  assert.equal(manifest.specs.find(spec => spec.id === '001').status, 'CLOSED');
});

test('automatic initialization preserves the package scripts that exist', async () => {
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const config = await runWizard(dir, { yes: true });
  assert.equal(config.qualityGates, 'npm test');
  await scaffoldProject(dir, config);
  assert.equal((await loadManifest(dir)).qualityGates, 'npm test');
  assert.ok(!(await readFile(join(dir, 'CONSTITUTION.md'), 'utf8')).includes('npm run lint'));
});

for (const [marker, command] of [['pom.xml', 'mvn test'], ['build.gradle', 'gradle test']]) {
  test(`interactive and automatic ${marker} use Java and retain build-tool gates`, async t => {
    await writeFile(join(dir, marker), '');
    const automatic = await runWizard(dir, { yes: true });
    assert.equal(automatic.stack, marker === 'pom.xml' ? 'Java / Maven' : 'Java / Gradle');
    assert.equal(automatic.docStandard, 'JavaDoc');
    assert.ok(automatic.qualityGates.includes(command));
    const result = await interactive(t);
    assert.equal(result.code, 0, result.stderr);
    const manifest = await loadManifest(dir);
    assert.equal(manifest.stack, 'Java / Spring Boot');
    assert.equal(manifest.documentationStandard, 'JavaDoc');
    assert.ok(manifest.qualityGates.includes(command));
  });
}

test('force interactive choices update constitution and manifest consistently', async t => {
  await scaffoldProject(dir, { projectName: 'Switch', stack: 'Node.js / TypeScript', docStandard: 'TSDoc', profile: 'general' });
  const result = await interactive(t, ['--force'], ['', '3', '', '2']);
  assert.equal(result.code, 0, result.stderr);
  const manifest = await loadManifest(dir);
  const constitution = await readFile(join(dir, 'CONSTITUTION.md'), 'utf8');
  assert.equal(manifest.profile, 'fintech');
  assert.equal(manifest.stack, 'Python (FastAPI / Django)');
  assert.equal(manifest.documentationStandard, 'Python Docstrings (PEP 257)');
  assert.ok(constitution.includes(manifest.stack));
  assert.ok(constitution.includes('PCI-DSS'));
});

test('reinitialization preserves custom configuration and rejects inconsistent changes without force', async () => {
  await scaffoldProject(dir, { projectName: 'Keep', profile: 'fintech', stack: 'Python', docStandard: 'PEP257', qualityGates: 'python -m unittest' });
  const before = await readFile(join(dir, 'CONSTITUTION.md'), 'utf8');
  await scaffoldProject(dir, await runWizard(dir, { yes: true }));
  const manifest = await loadManifest(dir);
  assert.equal(manifest.profile, 'fintech');
  assert.equal(manifest.stack, 'Python');
  assert.equal(manifest.qualityGates, 'python -m unittest');
  await assert.rejects(scaffoldProject(dir, await runWizard(dir, { yes: true, profile: 'general' })), /--force/);
  assert.equal((await loadManifest(dir)).profile, 'fintech');
  assert.equal(await readFile(join(dir, 'CONSTITUTION.md'), 'utf8'), before);
});

test('profile injection retains edited original rows, added rows and table notes with CRLF', async () => {
  await scaffoldProject(dir, { projectName: 'Security', profile: 'fintech' });
  const template = join(dir, 'specs', '_templates', '01-feature', 'spec.md');
  let content = await readFile(template, 'utf8');
  content = content.replace('Si es SÍ: Especificar cifrado en reposo/tránsito y permisos mínimos.', 'MANDATORY_HSM_POLICY');
  content = content.replace('| **¿Accede o procesa', '| CUSTOM_CONTROL Control de Seguridad | YES | Owner signoff. |\n| **¿Accede o procesa');
  content = content.replace('## 4. Experiencia', 'CUSTOM_TABLE_NOTE\n\n## 4. Experiencia').replace(/\r?\n/g, '\r\n');
  await writeFile(template, content);
  const spec = await createSpec(dir, 'feature', 'custom');
  const generated = await readFile(join(spec.specDir, 'spec.md'), 'utf8');
  for (const text of ['MANDATORY_HSM_POLICY', 'CUSTOM_CONTROL', 'CUSTOM_TABLE_NOTE', 'Does it touch balances, money, or ledger?']) {
    assert.ok(generated.includes(text), text);
  }
});

test('clarification headings alone fail, but answered clarification passes', async () => {
  await scaffoldProject(dir, { projectName: 'Audit' });
  const spec = await createSpec(dir, 'feature', 'clarification');
  const head = '# A long document title that must not satisfy clarification\n## 0. Clarification\n';
  const headings = '### 0.1 Registro de Preguntas y Decisiones Acordadas\n\n### 0.2 Supuestos Tecnicos y de Negocio\n';
  const tail = '\n## 1. Scope\nScope.\nNon-Goals.\nAcceptance Criteria.\n';
  await writeFile(join(spec.specDir, 'plan.md'), 'API Contracts and Rollback plan.');
  await writeFile(join(spec.specDir, 'tasks.md'), '- [ ] Implement payment.');
  await writeFile(join(spec.specDir, 'spec.md'), head + headings + tail);
  assert.equal((await auditSpec(dir)).valid, false);
  await writeFile(join(spec.specDir, 'spec.md'), head + headings + '\nDecision: accept card payments only; cash payments are excluded.\n' + tail);
  assert.equal((await auditSpec(dir)).valid, true);
});
