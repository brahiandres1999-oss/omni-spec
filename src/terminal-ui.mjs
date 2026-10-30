import { emitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

const ESC = '\x1b[';
const reset = `${ESC}0m`;
const palette = {
  blue: [88, 166, 255],
  amber: [245, 158, 11],
  green: [63, 185, 80],
  ink: [230, 237, 243],
  muted: [139, 148, 158],
};

/** Rich input requires both ends of an interactive terminal; redirected output stays plain. */
export function supportsTerminalUI(input, output, env = process.env, plain = false) {
  return Boolean(
    !plain &&
      input.isTTY &&
      output.isTTY &&
      typeof input.setRawMode === 'function' &&
      env.TERM !== 'dumb' &&
      !env.CI &&
      (!output.columns || output.columns >= 40) &&
      (!output.rows || output.rows >= 18),
  );
}

function colorEnabled(output, env) {
  return Boolean(output.isTTY && !Object.hasOwn(env, 'NO_COLOR') && env.FORCE_COLOR !== '0' && output.hasColors?.(16));
}

function paint(value, role, color, depth = 24) {
  if (!color) return value;
  if (role === 'ink') return `${ESC}1m${value}${reset}`;
  const rgb = palette[role];
  const code = depth >= 24 ? `38;2;${rgb.join(';')}` : { blue: 94, amber: 33, green: 32, ink: 97, muted: 90 }[role];
  return `${ESC}${code}m${value}${reset}`;
}

/** Keep user-controlled paths and declarations from injecting terminal control sequences. */
export function terminalText(value) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject literal terminal-control bytes in user-controlled labels.
  return stripVTControlCharacters(String(value)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

const charWidth = character =>
  /\p{Mark}/u.test(character) || /[\u200d\ufe0e\ufe0f]/u.test(character)
    ? 0
    : /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u.test(
          character,
        )
      ? 2
      : 1;

export function textWidth(value) {
  return [...stripVTControlCharacters(value)].reduce((width, char) => width + charWidth(char), 0);
}

function fit(value, width) {
  const text = terminalText(value);
  if (textWidth(text) <= width) return text;
  let result = '',
    used = 0;
  for (const char of text) {
    if (used + charWidth(char) > Math.max(0, width - 3)) break;
    result += char;
    used += charWidth(char);
  }
  return result + '.'.repeat(Math.min(3, width));
}

function wrap(value, width) {
  const words = terminalText(value).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (textWidth(`${line} ${word}`.trim()) <= width) line = `${line} ${word}`.trim();
    else {
      if (line) lines.push(line);
      if (textWidth(word) > width) {
        let chunk = '';
        for (const char of word) {
          if (textWidth(chunk + char) > width) {
            lines.push(chunk);
            chunk = '';
          }
          chunk += char;
        }
        line = chunk;
      } else line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const BANNER_PARTS = [
  ['  ___                  _ ', '____'],
  [' / _ \\ _ __ ___  _ __ (_)', ' ___| _ __   ___  ___'],
  ["| | | | '_ ` _ \\| '_ \\| ", "\\___ \\| '_ \\ / _ \\/ __|"],
  ['| |_| | | | | | | | | | ', '|___) | |_) |  __/ (__'],
  [' \\___/|_| |_| |_|_| |_|_', '|____/| .__/ \\___|\\___|'],
];

/** Clean dual-tone ASCII wordmark for OmniSpec: corporate blue for Omni and warm amber for Spec. */
export function logoLines(color = false, depth = 24, { version = '0.8.0' } = {}) {
  const versionTag = version?.startsWith('v') ? version : `v${version || '0.8.0'}`;
  const lines = BANNER_PARTS.map(
    ([omni, spec]) => paint(omni, 'blue', color, depth) + paint(spec, 'amber', color, depth),
  );
  lines.push(' '.repeat(30) + paint('|_|', 'amber', color, depth) + '   ' + paint(versionTag, 'muted', color, depth));
  return lines;
}

/** Render one complete frame; callers decide whether ANSI interaction is available. */
export function installerFrame(options) {
  return frameLayout(options).frame;
}

function frameLayout({
  version,
  language = 'en',
  step = 1,
  title,
  details = [],
  options = [],
  focus = 0,
  selected = [],
  multiple = false,
  columns = 90,
  rows = 32,
  color = false,
  depth = 24,
  detailsOffset = 0,
}) {
  const width = Math.max(16, Math.min(columns - 4, 96));
  const es = language === 'es';
  const lines = [];
  const detailLines = details.flatMap(detail => wrap(detail, width));
  const help = multiple
    ? es
      ? 'Arriba/Abajo: mover | Espacio: marcar | Enter: seguir'
      : 'Up/Down: move | Space: select | Enter: continue'
    : es
      ? 'Arriba/Abajo: mover | Enter: elegir | Esc: cancelar'
      : 'Up/Down: move | Enter: choose | Esc: cancel';
  const helpLines = [
    ...wrap(help, width),
    ...(multiple ? wrap(es ? 'Ctrl+A: todas | Esc: cancelar' : 'Ctrl+A: all | Esc: cancel', width) : []),
  ];
  const footerHeight = 1 + helpLines.length;
  const logoRoom = rows - detailLines.length - Math.min(9, options.length) - footerHeight - 8;
  if (columns >= 52 && logoRoom >= 6) {
    const logo = logoLines(color, depth, { version });
    for (const line of logo) lines.push(`  ${line}`);
    if (logoRoom >= 8) {
      lines.push('');
      lines.push(
        `  ${paint(es ? 'Construye con claridad. Comprueba con evidencia.' : 'Build with clarity. Verify with evidence.', 'muted', color, depth)}`,
      );
    }
  } else
    lines.push(`  ${paint('OmniSpec', 'amber', color, depth)}  ${fit(version ? `v${version}` : 'v0.8.0', width - 11)}`);
  lines.push(
    '',
    `  ${paint(`${es ? 'PREPARAR PROYECTO' : 'PREPARE PROJECT'}   ${step} / 3`, 'muted', color, depth)}`,
    `  ${paint('-'.repeat(width), 'muted', color, depth)}`,
    `  ${paint(fit(title, width), 'ink', color, depth)}`,
    '',
  );
  // Keep choices and help visible. Long paths and warnings stay readable through a
  // separate details viewport instead of overflowing the screen or being truncated.
  let detailRoom = detailLines.length;
  if (detailLines.length) {
    const minimumChoices = Math.min(2, options.length);
    const remaining = rows - 1 - lines.length - footerHeight - minimumChoices - 1;
    const optionCounter = options.length > minimumChoices ? 1 : 0;
    const available = Math.max(1, remaining - optionCounter);
    detailRoom = detailLines.length > available ? Math.max(1, available - 1) : detailLines.length;
  }
  const firstDetail = Math.min(Math.max(0, detailsOffset), Math.max(0, detailLines.length - detailRoom));
  for (const line of detailLines.slice(firstDetail, firstDetail + detailRoom))
    lines.push(`  ${paint(line, 'muted', color, depth)}`);
  if (detailLines.length > detailRoom)
    lines.push(
      `  ${paint(fit(`${firstDetail + 1}-${firstDetail + detailRoom} / ${detailLines.length} | PgUp/PgDn`, width), 'amber', color, depth)}`,
    );
  if (detailLines.length) lines.push('');
  const optionRoom = Math.max(1, rows - 1 - lines.length - footerHeight);
  const room = options.length > optionRoom ? Math.max(1, optionRoom - 1) : optionRoom;
  const first = Math.min(Math.max(0, focus - Math.floor(room / 2)), Math.max(0, options.length - room));
  options.slice(first, first + room).forEach((option, offset) => {
    const index = first + offset;
    const prefix = `${index === focus ? '>' : ' '} ${multiple ? (selected.includes(option.value) ? '[x] ' : '[ ] ') : ''}`;
    const label = fit(prefix + option.label, width);
    lines.push(`  ${paint(label, index === focus ? 'amber' : 'ink', color, depth)}`);
  });
  if (options.length > room)
    lines.push(
      `  ${paint(`${first + 1}-${Math.min(first + room, options.length)} / ${options.length}`, 'muted', color, depth)}`,
    );
  lines.push('', ...helpLines.map(line => `  ${paint(line, 'muted', color, depth)}`));
  return { frame: lines.join('\n'), detailsOffset: firstDetail, detailPageSize: Math.max(1, detailRoom) };
}

export class InstallerCancelled extends Error {
  constructor() {
    super('Installation cancelled');
    this.code = 'OMNI_INIT_CANCELLED';
  }
}

function restoreRawMode(input, wasRaw) {
  let failure;
  const capture = error => {
    failure = error;
  };
  // Node reports setRawMode failures through an error event as well as throws.
  input.on('error', capture);
  const attempt = () => {
    try {
      input.setRawMode(wasRaw);
    } catch (error) {
      failure = error;
    }
  };
  try {
    attempt();
    // Windows may fail while cancelling a pending read, after already stopping
    // it. Retry once with that read stopped; propagate any remaining failure.
    if (failure?.code === 'EPERM') {
      failure = undefined;
      attempt();
    }
    if (failure) throw failure;
  } finally {
    input.off('error', capture);
  }
}

/** Own raw input only while prompting; always restore the cursor, screen and prior raw mode. */
export class TerminalInstaller {
  constructor(input, output, { version = '', env = process.env } = {}) {
    this.input = input;
    this.output = output;
    this.version = version;
    this.color = colorEnabled(output, env);
    this.depth = output.getColorDepth?.() || 4;
    this.wasRaw = Boolean(input.isRaw);
    this.wasPaused = input.readableFlowing !== true;
    this.closed = false;
    this.frameLines = 0;
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write(`\n${ESC}?25l`);
  }

  choose({ language = 'en', step, title, details, options, defaultValue, multiple = false }) {
    let focus = Math.max(
      0,
      options.findIndex(option => option.value === defaultValue),
    );
    let selected = [],
      detailsOffset = 0,
      detailPageSize = 1;
    const draw = () => {
      const layout = frameLayout({
        version: this.version,
        language,
        step,
        title,
        details,
        options,
        focus,
        selected,
        multiple,
        columns: this.output.columns || 80,
        rows: this.output.rows || 24,
        color: this.color,
        depth: this.depth,
        detailsOffset,
      });
      const frame = layout.frame;
      detailsOffset = layout.detailsOffset;
      detailPageSize = layout.detailPageSize;
      const clear = this.frameLines ? `${ESC}${this.frameLines}A${ESC}1G${ESC}J` : '';
      this.output.write(clear + frame + '\n');
      this.frameLines = frame.split('\n').length;
    };
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        this.input.off('keypress', keypress);
        this.input.off('end', ended);
        this.input.off('error', failed);
        this.output.off('resize', redraw);
        this.cancelPrompt = null;
        if (error) reject(error);
        else resolve(value);
      };
      const ended = () => done(new InstallerCancelled());
      const failed = error => done(error);
      const keypress = (_text, key = {}) => {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return done(new InstallerCancelled());
        if (key.name === 'up') focus = (focus + options.length - 1) % options.length;
        else if (key.name === 'down') focus = (focus + 1) % options.length;
        else if (key.name === 'home') focus = 0;
        else if (key.name === 'end') focus = options.length - 1;
        else if (key.name === 'pageup') detailsOffset -= detailPageSize;
        else if (key.name === 'pagedown') detailsOffset += detailPageSize;
        else if (multiple && key.ctrl && key.name === 'a')
          selected = options.filter(option => option.value !== 'generic').map(option => option.value);
        else if (multiple && key.name === 'space') {
          const value = options[focus].value;
          if (value === 'generic') selected = selected.includes(value) ? [] : [value];
          else
            selected = selected.includes(value)
              ? selected.filter(item => item !== value)
              : [...selected.filter(item => item !== 'generic'), value];
        } else if (key.name === 'return' || key.name === 'enter')
          return done(null, multiple ? (selected.length ? selected : [options[focus].value]) : options[focus].value);
        try {
          draw();
        } catch (error) {
          done(error);
        }
      };
      const redraw = () => {
        try {
          draw();
        } catch (error) {
          done(error);
        }
      };
      this.cancelPrompt = () => done(new InstallerCancelled());
      this.input.on('keypress', keypress);
      this.input.once('end', ended);
      this.input.once('error', failed);
      this.output.on('resize', redraw);
      try {
        draw();
      } catch (error) {
        done(error);
      }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.cancelPrompt?.();
    try {
      restoreRawMode(this.input, this.wasRaw);
    } finally {
      // Stopping a Windows ConPTY read can break subsequent stdout writes; release its
      // event-loop reference instead, after removing every prompt listener.
      if (this.wasPaused) {
        if (typeof this.input.unref === 'function') this.input.unref();
        else this.input.pause();
      }
      const clear = this.frameLines ? `${ESC}${this.frameLines}A${ESC}1G${ESC}J` : '';
      this.output.write(`${clear}${ESC}?25h`);
    }
  }
}

/** Final result remains in scrollback, grouped by purpose and readable with or without color. */
export function resultSections(title, sections, { output = process.stdout, env = process.env, plain = false } = {}) {
  const rich = Boolean(!plain && output.isTTY && env.TERM !== 'dumb' && !env.CI);
  const color = rich && colorEnabled(output, env),
    depth = output.getColorDepth?.() || 4;
  const width = Math.max(24, Math.min((output.columns || 90) - 4, 96));
  const lines = ['', `  ${paint(terminalText(title), 'amber', color, depth)}`];
  for (const section of sections) {
    lines.push(
      '',
      `  ${paint(terminalText(section.title), 'blue', color, depth)}`,
      `  ${paint('-'.repeat(width), 'muted', color, depth)}`,
    );
    for (const line of section.lines)
      for (const part of rich ? wrap(line, width) : [terminalText(line)]) lines.push(`  ${part}`);
  }
  return lines.join('\n');
}

/** Stage updates correspond to real awaited operations, without estimated percentages or delays. */
export function installationProgress(output, language, plain = false, env = process.env) {
  const enabled = Boolean(!plain && output.isTTY && env.TERM !== 'dumb' && !env.CI);
  const color = colorEnabled(output, env),
    depth = output.getColorDepth?.() || 4;
  return {
    start() {
      if (enabled)
        output.write(
          `\n  ${paint('OmniSpec', 'amber', color, depth)}\n  ${language === 'es' ? 'Instalando archivos...' : 'Installing files...'}\n`,
        );
    },
    files() {
      if (enabled)
        output.write(
          `  [OK] ${language === 'es' ? 'Archivos preparados. Comprobando integridad...' : 'Files prepared. Checking integrity...'}\n`,
        );
    },
    done() {
      if (enabled) output.write(`  [OK] ${language === 'es' ? 'Integridad comprobada.' : 'Integrity checked.'}\n`);
    },
  };
}
