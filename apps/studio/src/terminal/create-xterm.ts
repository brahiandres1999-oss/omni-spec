/** Real xterm.js factory for the app (the tests inject doubles through the same TerminalFactory seam). */
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { colors, fonts } from '@/design/tokens';
import type { TerminalFactory, XtermLike } from './xterm-adapter';

export const createXterm: TerminalFactory = () => {
  const terminal = new Terminal({
    allowProposedApi: false,
    cursorBlink: true,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5_000,
    theme: {
      background: colors.canvas,
      foreground: colors.fg,
      cursor: colors.accentBright,
      cursorAccent: colors.canvas,
      selectionBackground: colors.divider,
      cyan: colors.accent,
      brightCyan: colors.accentBright,
      green: colors.attested,
      red: colors.breach,
    },
  });
  const fit = new FitAddon();
  let webgl: WebglAddon | null = null;
  try {
    webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl?.dispose());
  } catch {
    webgl = null;
  }
  return { terminal: terminal as unknown as XtermLike, fit, webgl };
};
