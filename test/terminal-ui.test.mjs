import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import {
  TerminalInstaller,
  supportsTerminalUI,
  installerFrame,
  resultSections,
  terminalText,
  textWidth,
  logoLines,
  installationProgress,
} from '../src/terminal-ui.mjs';

function terminal({ columns = 90, rows = 36, raw = false, env = {} } = {}) {
  const input = new PassThrough(),
    output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = raw;
  input.setRawMode = value => {
    input.isRaw = value;
  };
  output.columns = columns;
  output.rows = rows;
  output.hasColors = () => true;
  output.getColorDepth = () => 24;
  let text = '';
  output.on('data', data => {
    text += data.toString();
  });
  const ui = new TerminalInstaller(input, output, { version: '0.7.0-rc.2', env });
  return {
    ui,
    input,
    output,
    text: () => text,
    key: (name, ctrl = false) => input.emit('keypress', '', { name, ctrl }),
  };
}
const languages = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];
const tools = [
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'generic', label: 'Otra / sin decidir' },
];

test('interactive selection uses actual keypress decoding and restores raw mode/cursor', async () => {
  const t = terminal();
  try {
    const result = t.ui.choose({ step: 1, title: 'Idioma', options: languages });
    // Exercise readline decoding, not only synthetic key events.
    t.input.write(Buffer.from([27, 91, 66]));
    t.input.write('\r');
    assert.equal(await result, 'es');
    assert.match(stripVTControlCharacters(t.text()), /Español/);
  } finally {
    t.ui.close();
  }
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.listenerCount('keypress'), 0);
  assert.equal(t.output.listenerCount('resize'), 0);
  assert.ok(t.text().endsWith(`${String.fromCharCode(27)}[?25h`));
});

test('multi-select toggles tools, keeps generic exclusive and supports select-all', async () => {
  const t = terminal();
  try {
    const result = t.ui.choose({ step: 2, title: 'Herramientas', options: tools, multiple: true });
    t.key('space');
    t.key('down');
    t.key('space');
    t.key('down');
    t.key('space');
    t.key('return');
    assert.deepEqual(await result, ['generic']);
    const all = t.ui.choose({ step: 2, title: 'Herramientas', options: tools, multiple: true });
    t.key('a', true);
    t.key('return');
    assert.deepEqual(await all, ['antigravity', 'claude']);
    const none = t.ui.choose({ step: 2, title: 'Herramientas', options: tools, multiple: true });
    t.key('space');
    t.key('space');
    t.key('end');
    t.key('return');
    assert.deepEqual(await none, ['generic']);
  } finally {
    t.ui.close();
  }
});

test('cancel, Ctrl+C, EOF and stream errors release prompt listeners and keep prior raw state', async () => {
  for (const action of [
    t => t.key('escape'),
    t => t.key('c', true),
    t => t.input.emit('end'),
    t => t.input.emit('error', new Error('input failed')),
  ]) {
    const t = terminal({ raw: true });
    const result = t.ui.choose({ step: 1, title: 'Idioma', options: languages });
    action(t);
    await assert.rejects(result, /cancelled|input failed/);
    t.ui.close();
    t.ui.close();
    assert.equal(t.input.isRaw, true);
    assert.equal(t.input.listenerCount('keypress'), 0);
    assert.equal(t.output.listenerCount('resize'), 0);
  }
});

test('resize redraws the focused item; small frames stay within available columns and rows', async () => {
  const t = terminal();
  try {
    const result = t.ui.choose({
      language: 'es',
      step: 2,
      title: 'Herramientas',
      details: ['Destino: C:/dev/Proyecto IPS'],
      options: tools,
      multiple: true,
    });
    t.output.columns = 40;
    t.output.rows = 18;
    t.output.emit('resize');
    t.key('up');
    t.key('home');
    t.key('down');
    t.key('enter');
    assert.deepEqual(await result, ['claude']);
  } finally {
    t.ui.close();
  }
  for (const [columns, rows] of [
    [40, 18],
    [60, 24],
    [90, 36],
    [120, 48],
  ]) {
    const frame = installerFrame({
      version: '0.7.0-rc.2',
      language: 'es',
      step: 2,
      title: '¿Dónde usarás OmniSpec?',
      details: ['Destino: C:/dev/Proyecto IPS'],
      options: tools,
      multiple: true,
      columns,
      rows,
    });
    assert.ok(
      frame.split('\n').every(line => textWidth(line) < columns),
      `${columns}: ${frame}`,
    );
    assert.ok(frame.split('\n').length < rows, `${rows}: ${frame}`);
  }
});

test('UI detects TTY capabilities; plain/dumb/CI/redirected/narrow surfaces never enter raw UI', () => {
  const input = { isTTY: true, setRawMode() {} },
    output = { isTTY: true, columns: 80, rows: 24 };
  assert.equal(supportsTerminalUI(input, output, {}), true);
  assert.equal(supportsTerminalUI(input, output, {}, true), false);
  assert.equal(supportsTerminalUI(input, output, { TERM: 'dumb' }), false);
  assert.equal(supportsTerminalUI(input, output, { CI: '1' }), false);
  assert.equal(supportsTerminalUI(input, { ...output, isTTY: false }, {}), false);
  assert.equal(supportsTerminalUI({ ...input, isTTY: false }, output, {}), false);
  assert.equal(supportsTerminalUI(input, { ...output, columns: 30 }, {}), false);
});

test('long destinations and declarations scroll independently while choices stay on screen', async () => {
  const details = [
    `DESTINATION: C:/dev/${'project-directory/'.repeat(15)}`,
    'Existing files will be preserved.',
    ...Array.from({ length: 8 }, (_, index) => `Declaration ${index}: ${'full context '.repeat(8)}`),
    'FINAL DETAIL',
  ];
  for (const [columns, rows] of [
    [40, 18],
    [80, 24],
    [100, 40],
  ]) {
    for (const detailsOffset of [0, 4, 20, 1000]) {
      const frame = installerFrame({
        version: '0.7.0-rc.2',
        step: 3,
        title: 'Confirm destination',
        details,
        options: languages,
        columns,
        rows,
        detailsOffset,
      });
      assert.ok(frame.split('\n').length < rows, `${columns}x${rows}: ${frame}`);
      assert.ok(frame.split('\n').every(line => textWidth(line) < columns));
      assert.match(frame, /English/);
      assert.match(frame, /Español/);
      if (rows < 40) assert.match(frame, /PgUp\/PgDn/);
      if (detailsOffset === 0) assert.match(frame, /DESTINATION/);
      if (detailsOffset === 1000) assert.match(frame, /FINAL DETAIL/);
    }
  }
  const t = terminal({ columns: 40, rows: 18 });
  try {
    const result = t.ui.choose({ step: 3, title: 'Confirm', details, options: languages });
    let before = t.text().length;
    for (let index = 0; index < 100; index++) t.key('pagedown');
    assert.match(stripVTControlCharacters(t.text().slice(before)), /FINAL DETAIL/);
    before = t.text().length;
    for (let index = 0; index < 100; index++) t.key('pageup');
    assert.match(stripVTControlCharacters(t.text().slice(before)), /DESTINATION/);
    t.key('return');
    assert.equal(await result, 'en');
  } finally {
    t.ui.close();
  }
});

test('closing a ConPTY restores raw mode and releases its ref without stopping the pending read', () => {
  const t = terminal();
  let unreferenced = false,
    paused = false;
  t.input.unref = () => {
    unreferenced = true;
  };
  t.input.pause = () => {
    paused = true;
  };
  t.ui.close();
  assert.equal(t.input.isRaw, false);
  assert.equal(unreferenced, true);
  assert.equal(paused, false);
});

test('raw restoration retries a pending-read EPERM once and propagates a persistent failure', () => {
  for (const persistent of [false, true]) {
    const t = terminal();
    let calls = 0;
    t.input.setRawMode = value => {
      calls++;
      if (persistent || calls === 1)
        t.input.emit('error', Object.assign(new Error('setRawMode EPERM'), { code: 'EPERM' }));
      else t.input.isRaw = value;
    };
    if (persistent) assert.throws(() => t.ui.close(), /setRawMode EPERM/);
    else {
      t.ui.close();
      assert.equal(t.input.isRaw, false);
    }
    assert.equal(calls, 2);
    assert.equal(t.input.listenerCount('error'), 0);
    assert.ok(t.text().endsWith(`${String.fromCharCode(27)}[?25h`));
  }
});

test('NO_COLOR and plain summaries have no ANSI; untrusted labels cannot move the terminal cursor', () => {
  const t = terminal({ env: { NO_COLOR: '1' } });
  try {
    assert.equal(t.ui.color, false);
  } finally {
    t.ui.close();
  }
  const evil = `C:/project${String.fromCharCode(27)}[2J\r\nINJECTED`;
  assert.equal(terminalText(evil), 'C:/project  INJECTED');
  const plain = resultSections('OmniSpec', [{ title: 'INSTALACIÓN', lines: [evil] }], {
    output: t.output,
    plain: true,
  });
  assert.equal(plain, stripVTControlCharacters(plain));
  const colored = resultSections('OmniSpec', [{ title: 'NEXT', lines: ['Continue'] }], { output: t.output, env: {} });
  assert.notEqual(colored, stripVTControlCharacters(colored));
  assert.equal(logoLines().length, 6);
  assert.ok(logoLines().every(line => textWidth(line) <= 50));
  assert.equal(logoLines(false).join('\n'), stripVTControlCharacters(logoLines(false).join('\n')));
  assert.ok(logoLines(false).join('\n').includes('v0.8.0'));
  const brand = logoLines(true).join('\n');
  // Omni in blue (88;166;255), Spec in amber (245;158;11), and version in muted (139;148;158)
  assert.ok(brand.includes('38;2;88;166;255'));
  assert.ok(brand.includes('38;2;245;158;11'));
  assert.ok(brand.includes('38;2;139;148;158'));
});

test('progress appears only on a terminal and reports each completed stage explicitly', () => {
  const output = new PassThrough();
  let written = '';
  output.on('data', data => {
    written += data.toString();
  });
  installationProgress(output, 'es').start();
  assert.equal(written, '');
  output.isTTY = true;
  const progress = installationProgress(output, 'es', false, {});
  progress.start();
  assert.doesNotMatch(written, /Integridad comprobada/);
  progress.files();
  progress.done();
  assert.match(written, /Instalando archivos/);
  assert.match(written, /Integridad comprobada/);
});
