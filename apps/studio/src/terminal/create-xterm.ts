/**
 * Real xterm.js factory for the app (the tests inject doubles through the same TerminalFactory seam).
 *
 * Renderer: xterm's DOM renderer by default. It keeps the screen as real text in the DOM (readable by
 * assistive technology and by the E2E suite, E2E-06) and does not spend one of WebView2's limited WebGL
 * contexts per terminal. `createXterm({ webgl: true })` opts into the WebGL addon, which the bridge
 * loads with a DOM fallback and disposes like any addon (VT-04).
 */
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { colors, fonts } from '@/design/tokens';
import type { TerminalFactory, XtermLike } from './xterm-adapter';

export function createXtermFactory(options: { webgl?: boolean } = {}): TerminalFactory {
  return () => {
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
    let webgl: WebglAddon | null = null;
    if (options.webgl) {
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl?.dispose());
      } catch {
        webgl = null;
      }
    }
    return { terminal: terminal as unknown as XtermLike, fit: new FitAddon(), webgl };
  };
}

export const createXterm = createXtermFactory();
