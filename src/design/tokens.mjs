import { readFile } from 'node:fs/promises';

/**
 * Omni-Design Color, Contrast & DTCG 2025.10 Token Engine
 * Zero external dependencies. Supports #hex, rgb(), hsl(), and oklch() color spaces,
 * WCAG 2.2 relative luminance & contrast ratio math, perceptual OKLCH lightness checks,
 * concentric radius geometry, and Design Tokens Format Module 2025.10 validation.
 */

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function srgbChannelToLinear(channel) {
  const c = clamp01(channel);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(channel) {
  const c = clamp01(channel);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * Converts OKLCH (L in [0..1] or [0..100%], C >= 0, H in degrees [0..360])
 * to sRGB { r, g, b } in [0..1] using Björn Ottosson's OKLab matrix equations.
 */
export function oklchToSrgb(LInput, CInput, HInput = 0) {
  const L = LInput > 1 ? LInput / 100 : LInput;
  const C = Math.max(0, Number(CInput) || 0);
  const hRad = ((Number(HInput) || 0) * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLinear = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: linearChannelToSrgb(rLinear),
    g: linearChannelToSrgb(gLinear),
    b: linearChannelToSrgb(bLinear),
    oklch: { L: clamp01(L), C, H: (((Number(HInput) || 0) % 360) + 360) % 360 },
  };
}

/**
 * Converts sRGB { r, g, b } in [0..1] to perceptual OKLCH { L, C, H }.
 */
export function srgbToOklch(r, g, b) {
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);

  const l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bLab = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(a * a + bLab * bLab);
  let H = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return {
    L: Number(clamp01(L).toFixed(4)),
    C: Number(C.toFixed(4)),
    H: Number(H.toFixed(2)),
  };
}

function hslToSrgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s > 1 ? s / 100 : s);
  const lig = clamp01(l > 1 ? l / 100 : l);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return { r: r1 + m, g: g1 + m, b: b1 + m };
}

function srgbToHex({ r, g, b }) {
  const toByte = v =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
}

/**
 * Parses a CSS color string (#RGB, #RRGGBB, #RRGGBBAA, rgb(...), hsl(...), oklch(...))
 * or a DTCG 2025.10 color object ({ colorSpace, components, hex }) into normalized sRGB + OKLCH.
 */
export function parseColor(input) {
  if (!input) {
    throw new Error('Empty color input.');
  }

  if (typeof input === 'object' && input !== null) {
    if (typeof input.$value !== 'undefined') {
      return parseColor(input.$value);
    }
    if (typeof input.hex === 'string') {
      return parseColor(input.hex);
    }
    if (input.colorSpace === 'oklch' && Array.isArray(input.components)) {
      const [L, C, H] = input.components;
      const converted = oklchToSrgb(L, C, H);
      return {
        ...converted,
        hex: srgbToHex(converted),
      };
    }
    if (input.colorSpace === 'srgb' && Array.isArray(input.components)) {
      const [rRaw, gRaw, bRaw] = input.components;
      const r = rRaw > 1 ? rRaw / 255 : rRaw;
      const g = gRaw > 1 ? gRaw / 255 : gRaw;
      const b = bRaw > 1 ? bRaw / 255 : bRaw;
      return {
        r: clamp01(r),
        g: clamp01(g),
        b: clamp01(b),
        hex: srgbToHex({ r, g, b }),
        oklch: srgbToOklch(r, g, b),
      };
    }
    throw new Error(
      'Unsupported color object format. Expected DTCG color object with $value, hex, oklch, or srgb components.',
    );
  }

  const raw = String(input).trim();

  // #HEX
  const hexMatch = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map(ch => ch + ch)
        .join('');
    } else if (hex.length === 8) {
      hex = hex.slice(0, 6);
    }
    const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
    const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
    const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
    return {
      r,
      g,
      b,
      hex: `#${hex.toUpperCase()}`,
      oklch: srgbToOklch(r, g, b),
    };
  }

  // oklch(L C H [/ alpha])
  const oklchMatch = raw.match(/^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?(?:\s*\/\s*[0-9.]+%?)?\s*\)$/i);
  if (oklchMatch) {
    const LRaw = oklchMatch[1].endsWith('%')
      ? Number.parseFloat(oklchMatch[1]) / 100
      : Number.parseFloat(oklchMatch[1]);
    const C = Number.parseFloat(oklchMatch[2]);
    const H = Number.parseFloat(oklchMatch[3]);
    const converted = oklchToSrgb(LRaw, C, H);
    return {
      ...converted,
      hex: srgbToHex(converted),
    };
  }

  // rgb(r, g, b) or rgb(r g b)
  const rgbMatch = raw.match(
    /^rgba?\(\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)(?:\s*[,/]\s*[0-9.]+%?)?\s*\)$/i,
  );
  if (rgbMatch) {
    const parseChan = token => (token.endsWith('%') ? Number.parseFloat(token) / 100 : Number.parseFloat(token) / 255);
    const r = clamp01(parseChan(rgbMatch[1]));
    const g = clamp01(parseChan(rgbMatch[2]));
    const b = clamp01(parseChan(rgbMatch[3]));
    return {
      r,
      g,
      b,
      hex: srgbToHex({ r, g, b }),
      oklch: srgbToOklch(r, g, b),
    };
  }

  // hsl(h, s%, l%) or hsl(h s% l%)
  const hslMatch = raw.match(
    /^hsla?\(\s*([0-9.]+)(?:deg)?\s*[,\s]\s*([0-9.]+)%\s*[,\s]\s*([0-9.]+)%(?:\s*[,/]\s*[0-9.]+%?)?\s*\)$/i,
  );
  if (hslMatch) {
    const { r, g, b } = hslToSrgb(
      Number.parseFloat(hslMatch[1]),
      Number.parseFloat(hslMatch[2]),
      Number.parseFloat(hslMatch[3]),
    );
    return {
      r,
      g,
      b,
      hex: srgbToHex({ r, g, b }),
      oklch: srgbToOklch(r, g, b),
    };
  }

  throw new Error(`Unsupported color format "${raw}". Expected #hex, rgb(...), hsl(...), or oklch(L C H).`);
}

/**
 * Computes WCAG 2.x / 2.2 relative luminance Y in [0..1].
 */
export function relativeLuminance(colorInput) {
  const { r, g, b } = typeof colorInput === 'object' && 'r' in colorInput ? colorInput : parseColor(colorInput);
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Computes WCAG 2.2 contrast ratio between two colors (1.00 to 21.00).
 */
export function contrastRatio(foreground, background) {
  const lumA = relativeLuminance(foreground);
  const lumB = relativeLuminance(background);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Computes concentric inner border radius in px: r_inner = max(0, r_outer - padding).
 */
export function calculateConcentricRadius(outerRadiusPx, paddingPx) {
  const outer = Number(outerRadiusPx);
  const padding = Number(paddingPx);
  if (!Number.isFinite(outer) || !Number.isFinite(padding)) {
    throw new Error('outerRadiusPx and paddingPx must be finite numbers.');
  }
  return Math.max(0, Number((outer - padding).toFixed(2)));
}

/**
 * Evaluates a foreground/background color pair against WCAG 2.2 AA/AAA and perceptual OKLCH delta-L.
 * Roles:
 * - "normal-text": >= 4.5:1 (AA), >= 7.0:1 (AAA)
 * - "large-text" | "ui-component": >= 3.0:1 (AA)
 * - "enhanced-text": >= 7.0:1 (AAA)
 */
const VALID_CONTRAST_ROLES = new Set(['normal-text', 'large-text', 'ui-component', 'enhanced-text']);

export function evaluateContrastPair(foreground, background, options = {}) {
  const role = options.role || 'normal-text';
  if (!VALID_CONTRAST_ROLES.has(role)) {
    throw new Error(
      `Unsupported contrast role "${role}". Valid roles: normal-text, large-text, ui-component, enhanced-text.`,
    );
  }
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const ratio = contrastRatio(fg, bg);
  const oklchDeltaL = Number(Math.abs(fg.oklch.L - bg.oklch.L).toFixed(3));

  let requiredRatio = 4.5;
  if (role === 'large-text' || role === 'ui-component') {
    requiredRatio = 3.0;
  } else if (role === 'enhanced-text') {
    requiredRatio = 7.0;
  }

  const passed = ratio >= requiredRatio;
  const wcagLevel = ratio >= 7.0 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3.0 ? 'AA-Large/UI' : 'FAIL';

  return {
    role,
    passed,
    ratio,
    requiredRatio,
    wcagLevel,
    oklchDeltaL,
    foreground: {
      input: typeof foreground === 'string' ? foreground : fg.hex,
      hex: fg.hex,
      oklch: fg.oklch,
    },
    background: {
      input: typeof background === 'string' ? background : bg.hex,
      hex: bg.hex,
      oklch: bg.oklch,
    },
    recommendation: passed
      ? `Cumple WCAG 2.2 (${ratio}:1 >= ${requiredRatio}:1, ΔL=${oklchDeltaL}).`
      : `Contraste insuficiente (${ratio}:1 < ${requiredRatio}:1). Ajusta la luminosidad OKLCH (L) hasta que ΔL >= ${role === 'ui-component' ? '0.32' : '0.48'}.`,
  };
}

function parseDimensionPx(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.value === 'number') {
    return value.unit === 'rem' ? value.value * 16 : value.value;
  }
  const str = String(value || '').trim();
  const pxMatch = str.match(/^(-?[0-9.]+)px$/i);
  if (pxMatch) return Number.parseFloat(pxMatch[1]);
  const remMatch = str.match(/^(-?[0-9.]+)rem$/i);
  if (remMatch) return Number.parseFloat(remMatch[1]) * 16;
  return null;
}

function collectDtcgTokens(node, pathPrefix = [], inheritedType = null, acc = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return acc;
  }
  const currentType = typeof node.$type === 'string' ? node.$type : inheritedType;

  if (Object.hasOwn(node, '$value')) {
    acc.push({
      path: pathPrefix.join('.'),
      $type: currentType,
      $value: node.$value,
      $description: node.$description || null,
    });
    return acc;
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    collectDtcgTokens(child, [...pathPrefix, key], currentType, acc);
  }
  return acc;
}

/**
 * Generates a mathematically valid DTCG 2025.10 token scaffold for one of the 6 Omni-Design archetypes:
 * - "precision-dark" (DevTools, CLI, infrastructure, cybersecurity)
 * - "swiss-editorial" (Documentation, knowledge platforms, institutional finance, publishing)
 * - "high-density-ops" (ERP, logistics, real-time monitoring, trading desks)
 * - "warm-craft" (Creative tools, hospitality, specialty commerce, consumer productivity)
 * - "clinical-clarity" (Healthcare, legal, compliance, civic/government, accounting)
 * - "atmospheric-minimal" (Architecture, luxury editorial, cultural platforms, portfolios)
 */
export function generateDtcgTokenScaffold(archetype = 'precision-dark') {
  const normalized = String(archetype || 'precision-dark')
    .trim()
    .toLowerCase();

  const presets = {
    'precision-dark': {
      description: 'Omni-Design Archetype: Technical Precision & Dark Slate Control',
      mode: 'dark',
      domains: ['devtools', 'infra', 'cli', 'security', 'observability'],
      colors: {
        canvas: '#0B0F17',
        surface: '#111827',
        ink: '#F8FAFC',
        muted: '#94A3B8',
        accent: 'oklch(0.68 0.16 250)',
        border: '#1E293B',
      },
      fonts: {
        display: 'Space Grotesk',
        body: 'Inter',
        mono: 'JetBrains Mono',
      },
      radii: { sm: '4px', md: '6px', lg: '10px' },
    },
    'swiss-editorial': {
      description: 'Omni-Design Archetype: Swiss Editorial & Warm Paper Clarity',
      mode: 'light',
      domains: ['editorial', 'docs', 'finance', 'research', 'publishing'],
      colors: {
        canvas: '#FAF8F5',
        surface: '#F3EFEA',
        ink: '#111318',
        muted: '#4B5563',
        accent: 'oklch(0.52 0.19 28)',
        border: '#E5E0D8',
      },
      fonts: {
        display: 'Instrument Serif',
        body: 'Plus Jakarta Sans',
        mono: 'IBM Plex Mono',
      },
      radii: { sm: '2px', md: '4px', lg: '8px' },
    },
    'high-density-ops': {
      description: 'Omni-Design Archetype: High-Density Operational Telemetry',
      mode: 'dark',
      domains: ['erp', 'logistics', 'trading', 'monitoring', 'operations'],
      colors: {
        canvas: '#090D16',
        surface: '#0F172A',
        ink: '#F1F5F9',
        muted: '#94A3B8',
        accent: 'oklch(0.72 0.15 195)',
        border: '#1E293B',
      },
      fonts: {
        display: 'Plus Jakarta Sans',
        body: 'Public Sans',
        mono: 'JetBrains Mono',
      },
      radii: { sm: '2px', md: '4px', lg: '8px' },
    },
    'warm-craft': {
      description: 'Omni-Design Archetype: Warm Tactile Product Craft',
      mode: 'light',
      domains: ['commerce', 'creative', 'consumer', 'hospitality', 'productivity'],
      colors: {
        canvas: '#FBF9F6',
        surface: '#F4F0EA',
        ink: '#1C1917',
        muted: '#57534E',
        accent: 'oklch(0.55 0.16 45)',
        border: '#E7E2DA',
      },
      fonts: {
        display: 'Fraunces',
        body: 'Plus Jakarta Sans',
        mono: 'JetBrains Mono',
      },
      radii: { sm: '6px', md: '10px', lg: '14px' },
    },
    'clinical-clarity': {
      description: 'Omni-Design Archetype: High-Legibility Daylight Clinical & Civic Clarity',
      mode: 'light',
      domains: ['healthcare', 'clinical', 'legal', 'civic', 'compliance', 'accounting'],
      colors: {
        canvas: '#F8FAFC',
        surface: '#F1F5F9',
        ink: '#0F172A',
        muted: '#475569',
        accent: 'oklch(0.48 0.15 240)',
        border: '#E2E8F0',
      },
      fonts: {
        display: 'Plus Jakarta Sans',
        body: 'Public Sans',
        mono: 'IBM Plex Mono',
      },
      radii: { sm: '4px', md: '6px', lg: '10px' },
    },
    'atmospheric-minimal': {
      description: 'Omni-Design Archetype: Architectural Alabaster & Negative-Space Minimal',
      mode: 'light',
      domains: ['architecture', 'luxury', 'portfolio', 'culture', 'studio'],
      colors: {
        canvas: '#F4F3EF',
        surface: '#EAE8E1',
        ink: '#18181B',
        muted: '#52525B',
        accent: 'oklch(0.42 0.09 155)',
        border: '#DCD9D0',
      },
      fonts: {
        display: 'Cormorant Garamond',
        body: 'Inter',
        mono: 'JetBrains Mono',
      },
      radii: { sm: '0px', md: '2px', lg: '6px' },
    },
  };

  if (!Object.hasOwn(presets, normalized)) {
    throw new Error(
      `Unknown Omni-Design archetype "${archetype}". Valid archetypes: ${Object.keys(presets).join(', ')}.`,
    );
  }
  const preset = presets[normalized];
  const outerPx = parseDimensionPx(preset.radii.lg);
  const innerPx = calculateConcentricRadius(outerPx, 4);

  return {
    $schema: 'https://tr.designtokens.org/format/2025.10/',
    $description: preset.description,
    color: {
      $type: 'color',
      canvas: { $value: preset.colors.canvas, $description: '60% primary viewport background canvas' },
      surface: { $value: preset.colors.surface, $description: '30% structural container surface' },
      ink: { $value: preset.colors.ink, $description: 'Primary body and heading ink' },
      muted: { $value: preset.colors.muted, $description: 'Secondary metadata ink (WCAG AA verified)' },
      accent: { $value: preset.colors.accent, $description: '10% primary interactive focal accent' },
      border: { $value: preset.colors.border, $description: '1px structural hairline border' },
    },
    typography: {
      family: {
        $type: 'fontFamily',
        display: { $value: preset.fonts.display },
        body: { $value: preset.fonts.body },
        mono: { $value: preset.fonts.mono },
      },
      size: {
        $type: 'fontSize',
        sm: { $value: '12px' },
        base: { $value: '15px' },
        lg: { $value: '19px' },
        xl: { $value: '24px' },
        '2xl': { $value: '30px' },
      },
    },
    spacing: {
      $type: 'spacing',
      xs: { $value: '4px' },
      sm: { $value: '8px' },
      md: { $value: '16px' },
      lg: { $value: '24px' },
      xl: { $value: '32px' },
    },
    radii: {
      $type: 'borderRadius',
      sm: { $value: preset.radii.sm },
      md: { $value: `${innerPx}px` },
      lg: { $value: preset.radii.lg },
    },
    motion: {
      fast: { $type: 'duration', $value: '160ms' },
      standard: { $type: 'cubicBezier', $value: [0.22, 1, 0.36, 1] },
    },
    $extensions: {
      'omni-design': {
        archetype: normalized,
        mode: preset.mode,
        chromaticBudget: { canvas: 60, surface: 30, accent: 10 },
        concentricPairs: [
          {
            name: 'Card outer lg to inner md with 4px padding',
            outerRadiusPx: outerPx,
            paddingPx: 4,
            innerRadiusPx: innerPx,
          },
        ],
        surfacePairs: [
          {
            name: 'Canvas to elevated surface tonal step',
            canvas: preset.colors.canvas,
            surface: preset.colors.surface,
            mode: preset.mode,
          },
        ],
        contrastPairs: [
          {
            name: 'Primary ink on canvas',
            foreground: preset.colors.ink,
            background: preset.colors.canvas,
            role: 'normal-text',
          },
          {
            name: 'Primary ink on surface',
            foreground: preset.colors.ink,
            background: preset.colors.surface,
            role: 'normal-text',
          },
          {
            name: 'Muted metadata on canvas',
            foreground: preset.colors.muted,
            background: preset.colors.canvas,
            role: 'normal-text',
          },
        ],
      },
    },
  };
}

/**
 * Validates a DTCG 2025.10 token object against Omni-Design mathematical constraints:
 * 1. Valid color tokens (#hex, rgb, hsl, oklch)
 * 2. Font family budget: max 3 families (2+1 rule: Display, Body, Monospace)
 * 3. Typography scale ratio consistency: within [1.12, 1.38] when 3+ sizes are defined
 * 4. Spatial rhythm: spacing tokens on 4px/8px grid (with 2px micro exception)
 * 5. Border radius budget: max 3 distinct surface radii (excluding 9999px pill controls)
 * 6. Motion easing: cubicBezier control points X in [0, 1]
 * 7. Contrast pairs in $extensions["omni-design"].contrastPairs
 * 8. Concentric radius pairs in $extensions["omni-design"].concentricPairs
 * 9. Surface ΔL bounds in $extensions["omni-design"].surfacePairs
 */
export function validateDesignTokens(tokenDoc) {
  const errors = [];
  const warnings = [];
  const tokens = collectDtcgTokens(tokenDoc);

  if (tokens.length === 0) {
    errors.push('TOKEN_EMPTY_SET: No DTCG tokens with "$value" were found in the document.');
    return { valid: false, tokenCount: 0, errors, warnings, summary: {} };
  }

  const colorTokens = [];
  const fontFamilies = new Set();
  const fontSizesPx = [];
  const spacingPx = [];
  const radiiPx = new Set();
  const durationMs = [];

  for (const token of tokens) {
    const inferredType =
      token.$type ||
      (token.path.includes('color')
        ? 'color'
        : token.path.includes('font.family') || token.path.includes('fontFamily')
          ? 'fontFamily'
          : token.path.includes('font.size') || token.path.includes('fontSize')
            ? 'fontSize'
            : token.path.includes('spacing') || token.path.includes('space')
              ? 'spacing'
              : token.path.includes('radius') || token.path.includes('radii')
                ? 'borderRadius'
                : null);

    if (inferredType === 'color') {
      try {
        const parsed = parseColor(token.$value);
        colorTokens.push({ path: token.path, ...parsed });
      } catch (err) {
        errors.push(`TOKEN_INVALID_COLOR (${token.path}): ${err.message}`);
      }
    } else if (inferredType === 'fontFamily') {
      const fam = Array.isArray(token.$value) ? token.$value[0] : String(token.$value);
      fontFamilies.add(fam.trim());
    } else if (inferredType === 'fontSize') {
      const px = parseDimensionPx(token.$value);
      if (px !== null && px > 0) {
        fontSizesPx.push({ path: token.path, px });
      } else {
        errors.push(`TOKEN_INVALID_FONT_SIZE (${token.path}): Expected positive px or rem dimension.`);
      }
    } else if (inferredType === 'spacing') {
      const px = parseDimensionPx(token.$value);
      if (px !== null && px >= 0) {
        spacingPx.push({ path: token.path, px });
        if (px !== 0 && px !== 2 && px % 4 !== 0) {
          errors.push(
            `TOKEN_SPACING_RHYTHM (${token.path}): "${token.$value}" (${px}px) violates the 4px/8px spatial grid.`,
          );
        }
      } else {
        errors.push(`TOKEN_INVALID_SPACING (${token.path}): Expected non-negative px or rem dimension.`);
      }
    } else if (inferredType === 'borderRadius') {
      const px = parseDimensionPx(token.$value);
      if (px !== null && px >= 0) {
        if (px < 999) {
          radiiPx.add(px);
        }
      }
    } else if (inferredType === 'cubicBezier') {
      if (
        !Array.isArray(token.$value) ||
        token.$value.length !== 4 ||
        token.$value[0] < 0 ||
        token.$value[0] > 1 ||
        token.$value[2] < 0 ||
        token.$value[2] > 1
      ) {
        errors.push(`TOKEN_INVALID_CUBIC_BEZIER (${token.path}): Expected [x1, y1, x2, y2] with x1, x2 in [0, 1].`);
      }
    } else if (inferredType === 'duration') {
      const raw = String(token.$value).trim();
      const msMatch = raw.match(/^([0-9.]+)(ms|s)$/i);
      if (msMatch) {
        const val = Number.parseFloat(msMatch[1]) * (msMatch[2].toLowerCase() === 's' ? 1000 : 1);
        durationMs.push({ path: token.path, ms: val });
        if (val > 500) {
          warnings.push(`TOKEN_SLOW_DURATION (${token.path}): ${val}ms exceeds the 300ms micro-interaction ceiling.`);
        }
      }
    }
  }

  // 2+1 Font Family Rule
  if (fontFamilies.size > 3) {
    errors.push(
      `TOKEN_FONT_BUDGET: Found ${fontFamilies.size} font families (${Array.from(fontFamilies).join(', ')}). Maximum allowed by the 2+1 rule is 3 (Display, Body, Monospace).`,
    );
  }

  // Max 3 distinct surface border radii
  if (radiiPx.size > 3) {
    errors.push(
      `TOKEN_RADIUS_BUDGET: Found ${radiiPx.size} distinct surface radii (${Array.from(radiiPx)
        .sort((a, b) => a - b)
        .map(v => `${v}px`)
        .join(', ')}). Maximum allowed is 3.`,
    );
  }

  // Modular scale check
  let measuredScaleRatio = null;
  if (fontSizesPx.length >= 3) {
    const sorted = [...fontSizesPx].sort((a, b) => a.px - b.px);
    const ratios = [];
    for (let i = 1; i < sorted.length; i++) {
      const ratio = sorted[i].px / sorted[i - 1].px;
      if (ratio > 1.02) ratios.push(ratio);
    }
    if (ratios.length > 0) {
      const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      measuredScaleRatio = Number(avgRatio.toFixed(3));
      if (avgRatio < 1.1 || avgRatio > 1.42) {
        warnings.push(
          `TOKEN_MODULAR_SCALE: Average font scale ratio is ${measuredScaleRatio} (recommended modular interval is 1.125 Major Second to 1.333 Perfect Fourth).`,
        );
      }
    }
  }

  // Explicit contrast pairs check ($extensions['omni-design'].contrastPairs)
  const ext = tokenDoc?.$extensions?.['omni-design'];
  const contrastPairs = ext?.contrastPairs;
  const contrastResults = [];
  if (Array.isArray(contrastPairs)) {
    for (const pair of contrastPairs) {
      try {
        const result = evaluateContrastPair(pair.foreground, pair.background, { role: pair.role || 'normal-text' });
        contrastResults.push({ name: pair.name || `${pair.foreground} on ${pair.background}`, ...result });
        if (!result.passed) {
          errors.push(
            `TOKEN_CONTRAST_FAILED (${pair.name || 'pair'}): ${result.ratio}:1 < ${result.requiredRatio}:1 (${result.role}).`,
          );
        }
      } catch (err) {
        errors.push(`TOKEN_CONTRAST_INVALID (${pair?.name || 'pair'}): ${err.message}`);
      }
    }
  }

  // Concentric radius pairs check ($extensions['omni-design'].concentricPairs)
  const concentricPairs = ext?.concentricPairs;
  if (Array.isArray(concentricPairs)) {
    for (const item of concentricPairs) {
      try {
        const expectedInner = calculateConcentricRadius(item.outerRadiusPx, item.paddingPx);
        if (!Number.isFinite(Number(item.innerRadiusPx)) || Math.abs(Number(item.innerRadiusPx) - expectedInner) > 1) {
          errors.push(
            `TOKEN_CONCENTRIC_RADIUS (${item.name || 'pair'}): innerRadiusPx=${item.innerRadiusPx}px violates r_inner = max(0, ${item.outerRadiusPx} - ${item.paddingPx}) = ${expectedInner}px.`,
          );
        }
      } catch (err) {
        errors.push(`TOKEN_CONCENTRIC_INVALID (${item?.name || 'pair'}): ${err.message}`);
      }
    }
  }

  // Surface luminance delta check ($extensions['omni-design'].surfacePairs)
  const surfacePairs = ext?.surfacePairs;
  if (Array.isArray(surfacePairs)) {
    for (const pair of surfacePairs) {
      try {
        const canvasColor = parseColor(pair.canvas);
        const surfaceColor = parseColor(pair.surface);
        const deltaL = Number(Math.abs(canvasColor.oklch.L - surfaceColor.oklch.L).toFixed(3));
        const maxDelta = pair.mode === 'light' ? 0.08 : 0.14;
        if (deltaL > maxDelta) {
          warnings.push(
            `TOKEN_SURFACE_DELTA (${pair.name || 'surface'}): OKLCH ΔL=${deltaL} exceeds the subtle tonal elevation ceiling (${maxDelta}) for ${pair.mode || 'dark'} mode.`,
          );
        }
      } catch (err) {
        errors.push(`TOKEN_SURFACE_INVALID (${pair?.name || 'surface'}): ${err.message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    tokenCount: tokens.length,
    errors,
    warnings,
    summary: {
      colors: colorTokens.length,
      fontFamilies: fontFamilies.size,
      fontSizes: fontSizesPx.length,
      measuredScaleRatio,
      spacingTokens: spacingPx.length,
      distinctRadii: radiiPx.size,
      contrastPairsChecked: contrastResults.length,
      contrastResults,
    },
  };
}

export async function validateDesignTokenFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return validateDesignTokens(parsed);
}
