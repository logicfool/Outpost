import { AppError, object } from './validation';
export interface CrosshairLines {
  lineThickness: number;
  lineLength: number;
  lineLengthVertical: number;
  lineOffset: number;
  opacity: number;
  bShowLines: boolean;
  bAllowVertScaling: boolean;
  bShowMovementError: boolean;
  bShowShootingError: boolean;
  firingErrorScale: number;
  movementErrorScale: number;
}
export interface CrosshairLayer {
  color: string;
  outlineColor: string;
  bHasOutline: boolean;
  outlineThickness: number;
  outlineOpacity: number;
  centerDotSize: number;
  centerDotOpacity: number;
  bDisplayCenterDot: boolean;
  bFixMinErrorAcrossWeapons: boolean;
  bFadeCrosshairWithFiringError: boolean;
  innerLines: CrosshairLines;
  outerLines: CrosshairLines;
}
export interface Crosshair {
  profileName: string;
  primary: CrosshairLayer;
  aDS: CrosshairLayer;
  sniper: {
    color: string;
    centerDotSize: number;
    centerDotOpacity: number;
    bDisplayCenterDot: boolean;
  };
  bUseAdvancedOptions: boolean;
  bUsePrimaryCrosshairForADS: boolean;
  bUseCustomCrosshairOnAllPrimary: boolean;
}
export const CROSSHAIR_COLORS = [
  'FFFFFFFF',
  '00FF00FF',
  '7FFF00FF',
  'DFFF00FF',
  'FFFF00FF',
  '00FFFFFF',
  'FF00FFFF',
  'FF0000FF',
];
export function crosshairName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 48 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new AppError('CROSSHAIR_NAME', 'Use a name from 1 to 48 characters.');
  return value.trim();
}
export function defaultCrosshair(name = 'New crosshair'): Crosshair {
  const lines = (outer: boolean): CrosshairLines => ({
    lineThickness: 2,
    lineLength: outer ? 2 : 6,
    lineLengthVertical: outer ? 2 : 6,
    lineOffset: outer ? 10 : 3,
    opacity: outer ? 0.35 : 0.8,
    bShowLines: true,
    bAllowVertScaling: false,
    bShowMovementError: outer,
    bShowShootingError: true,
    firingErrorScale: 1,
    movementErrorScale: 1,
  });
  const layer = (): CrosshairLayer => ({
    color: 'FFFFFFFF',
    outlineColor: '000000FF',
    bHasOutline: true,
    outlineThickness: 1,
    outlineOpacity: 0.5,
    centerDotSize: 2,
    centerDotOpacity: 1,
    bDisplayCenterDot: false,
    bFixMinErrorAcrossWeapons: false,
    bFadeCrosshairWithFiringError: true,
    innerLines: lines(false),
    outerLines: lines(true),
  });
  return {
    profileName: crosshairName(name),
    primary: layer(),
    aDS: layer(),
    sniper: { color: 'FF0000FF', centerDotSize: 1, centerDotOpacity: 0.8, bDisplayCenterDot: true },
    bUseAdvancedOptions: false,
    bUsePrimaryCrosshairForADS: true,
    bUseCustomCrosshairOnAllPrimary: false,
  };
}
export function colorHex(value: unknown): string {
  if (typeof value !== 'string' || !/^#?[a-f0-9]{6}([a-f0-9]{2})?$/i.test(value))
    throw new AppError('CROSSHAIR_COLOR', 'Enter a six- or eight-digit hex colour.');
  const hex = value.replace('#', '').toUpperCase();
  return hex.length === 6 ? hex + 'FF' : hex;
}
export function cssColor(hex: string): string {
  return '#' + colorHex(hex);
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new AppError('CROSSHAIR_RANGE', 'A crosshair setting is outside its supported range.');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new AppError('CROSSHAIR_SHAPE', 'A crosshair switch is invalid.');
  return value;
}
export function validateCrosshair(value: unknown): Crosshair {
  const v = object(value);
  const line = (value: unknown): CrosshairLines => {
    const l = object(value);
    return {
      lineThickness: number(l.lineThickness, 0, 10, true),
      lineLength: number(l.lineLength, 0, 20, true),
      lineLengthVertical: number(l.lineLengthVertical, 0, 20, true),
      lineOffset: number(l.lineOffset, 0, 40, true),
      opacity: number(l.opacity, 0, 1),
      bShowLines: bool(l.bShowLines),
      bAllowVertScaling: bool(l.bAllowVertScaling),
      bShowMovementError: bool(l.bShowMovementError),
      bShowShootingError: bool(l.bShowShootingError),
      firingErrorScale: number(l.firingErrorScale, 0, 3),
      movementErrorScale: number(l.movementErrorScale, 0, 3),
    };
  };
  const layer = (value: unknown): CrosshairLayer => {
    const l = object(value);
    return {
      color: colorHex(l.color),
      outlineColor: colorHex(l.outlineColor),
      bHasOutline: bool(l.bHasOutline),
      outlineThickness: number(l.outlineThickness, 0, 6, true),
      outlineOpacity: number(l.outlineOpacity, 0, 1),
      centerDotSize: number(l.centerDotSize, 0, 6, true),
      centerDotOpacity: number(l.centerDotOpacity, 0, 1),
      bDisplayCenterDot: bool(l.bDisplayCenterDot),
      bFixMinErrorAcrossWeapons: bool(l.bFixMinErrorAcrossWeapons),
      bFadeCrosshairWithFiringError: bool(l.bFadeCrosshairWithFiringError),
      innerLines: line(l.innerLines),
      outerLines: line(l.outerLines),
    };
  };
  const s = object(v.sniper);
  return {
    profileName: crosshairName(v.profileName),
    primary: layer(v.primary),
    aDS: layer(v.aDS),
    sniper: {
      color: colorHex(s.color),
      centerDotSize: number(s.centerDotSize, 0, 6, true),
      centerDotOpacity: number(s.centerDotOpacity, 0, 1),
      bDisplayCenterDot: bool(s.bDisplayCenterDot),
    },
    bUseAdvancedOptions: bool(v.bUseAdvancedOptions),
    bUsePrimaryCrosshairForADS: bool(v.bUsePrimaryCrosshairForADS),
    bUseCustomCrosshairOnAllPrimary: bool(v.bUseCustomCrosshairOnAllPrimary),
  };
}
const LINE_FIELDS: Record<string, keyof CrosshairLines> = {
  b: 'bShowLines',
  a: 'opacity',
  l: 'lineLength',
  v: 'lineLengthVertical',
  g: 'bAllowVertScaling',
  t: 'lineThickness',
  o: 'lineOffset',
  m: 'bShowMovementError',
  s: 'movementErrorScale',
  f: 'bShowShootingError',
  e: 'firingErrorScale',
};
const LAYER_FIELDS: Record<string, keyof CrosshairLayer> = {
  h: 'bHasOutline',
  t: 'outlineThickness',
  o: 'outlineOpacity',
  d: 'bDisplayCenterDot',
  z: 'centerDotSize',
  a: 'centerDotOpacity',
  m: 'bFixMinErrorAcrossWeapons',
  f: 'bFadeCrosshairWithFiringError',
};

export function importCrosshairCode(input: string, name = 'Imported crosshair'): Crosshair {
  if (typeof input !== 'string' || input.length > 4096)
    throw new AppError('CROSSHAIR_CODE', 'The crosshair code is too long.');
  const parts = input.trim().replace(/;+$/, '').split(';');
  if (parts[0] !== '0' || parts.some((p) => !p))
    throw new AppError('CROSSHAIR_CODE', 'Enter a complete VALORANT code starting with 0.');
  const result = defaultCrosshair(name),
    seen = new Set<string>();
  let section = '',
    index = 1;
  const set = (target: object, key: string, text: string) => {
    const r = target as Record<string, unknown>;
    if (typeof r[key] === 'boolean') {
      if (!/^[01]$/.test(text))
        throw new AppError('CROSSHAIR_CODE', 'Crosshair switches must be 0 or 1.');
      r[key] = text === '1';
    } else {
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text))
        throw new AppError('CROSSHAIR_CODE', 'The code contains an invalid number.');
      r[key] = Number(text);
    }
  };
  const custom: Record<string, string> = {},
    colors: Record<string, number> = {};
  while (index < parts.length) {
    const key = parts[index++]!;
    if (['P', 'A', 'S'].includes(key)) {
      if (seen.has(key)) throw new AppError('CROSSHAIR_CODE', 'Repeated crosshair section.');
      seen.add(key);
      section = key;
      continue;
    }
    const value = parts[index++];
    if (value === undefined || seen.has(section + ':' + key))
      throw new AppError('CROSSHAIR_CODE', 'Missing or duplicate settings.');
    seen.add(section + ':' + key);
    if (!section) {
      const fields: Record<string, string> = {
        s: 'bUseAdvancedOptions',
        p: 'bUsePrimaryCrosshairForADS',
        c: 'bUseCustomCrosshairOnAllPrimary',
      };
      if (!Object.hasOwn(fields, key))
        throw new AppError('CROSSHAIR_CODE_UNSUPPORTED', 'Unsupported general code field.');
      set(result, fields[key]!, value);
      continue;
    }
    if (key === 'c') {
      if (!/^[0-8]$/.test(value)) throw new AppError('CROSSHAIR_COLOR', 'Invalid colour index.');
      colors[section] = Number(value);
      continue;
    }
    if (key === (section === 'S' ? 't' : 'u')) {
      custom[section] = colorHex(value);
      continue;
    }
    if (section === 'S') {
      const fields: Record<string, string> = {
        d: 'bDisplayCenterDot',
        s: 'centerDotSize',
        o: 'centerDotOpacity',
      };
      if (!Object.hasOwn(fields, key))
        throw new AppError('CROSSHAIR_CODE_UNSUPPORTED', 'Unsupported sniper code field.');
      set(result.sniper, fields[key]!, value);
      continue;
    }
    const l = section === 'P' ? result.primary : result.aDS;
    if (/^[01]/.test(key)) {
      const field = LINE_FIELDS[key.slice(1)];
      if (
        !field ||
        !Object.hasOwn(
          /^[01]/.test(key) ? LINE_FIELDS : LAYER_FIELDS,
          /^[01]/.test(key) ? key.slice(1) : key,
        )
      )
        throw new AppError('CROSSHAIR_CODE_UNSUPPORTED', 'Unsupported line code field.');
      set(key[0] === '0' ? l.innerLines : l.outerLines, field, value);
    } else {
      const field = LAYER_FIELDS[key];
      if (
        !field ||
        !Object.hasOwn(
          /^[01]/.test(key) ? LINE_FIELDS : LAYER_FIELDS,
          /^[01]/.test(key) ? key.slice(1) : key,
        )
      )
        throw new AppError('CROSSHAIR_CODE_UNSUPPORTED', 'Unsupported crosshair code field.');
      set(l, field, value);
    }
  }
  for (const s of ['P', 'A', 'S']) {
    const l = s === 'P' ? result.primary : s === 'A' ? result.aDS : result.sniper;
    if (custom[s] && colors[s] !== 8)
      throw new AppError('CROSSHAIR_COLOR', 'A custom colour requires the custom colour index.');
    if (colors[s] === 8) {
      if (!custom[s]) throw new AppError('CROSSHAIR_COLOR', 'Custom colour is missing.');
      l.color = custom[s]!;
    } else if (colors[s] !== undefined) l.color = CROSSHAIR_COLORS[colors[s]!]!;
    if (s !== 'S')
      for (const line of [(l as CrosshairLayer).innerLines, (l as CrosshairLayer).outerLines])
        if (!line.bAllowVertScaling) line.lineLengthVertical = line.lineLength;
  }
  for (const s of ['P', 'A', 'S'])
    if (seen.has(s) && ![...seen].some((k) => k.startsWith(s + ':')))
      throw new AppError('CROSSHAIR_CODE', 'A crosshair section is empty.');
  return validateCrosshair(result);
}
export function exportCrosshairCode(input: Crosshair): string {
  const p = validateCrosshair(input),
    out = ['0'];
  const pair = (k: string, v: string | number | boolean) => {
    out.push(k, String(typeof v === 'boolean' ? Number(v) : v));
  };
  pair('s', p.bUseAdvancedOptions);
  pair('p', p.bUsePrimaryCrosshairForADS);
  pair('c', p.bUseCustomCrosshairOnAllPrimary);
  const color = (hex: string, key: string) => {
    const c = CROSSHAIR_COLORS.indexOf(hex);
    pair('c', c < 0 ? 8 : c);
    if (c < 0) pair(key, hex);
  };
  for (const [section, l] of [
    ['P', p.primary],
    ['A', p.aDS],
  ] as const) {
    if (l.bHasOutline && l.outlineColor !== '000000FF')
      throw new AppError(
        'CROSSHAIR_EXPORT',
        'Riot codes cannot represent this custom outline colour. Your saved profile is unchanged.',
      );
    out.push(section);
    color(l.color, 'u');
    for (const [key, field] of Object.entries(LAYER_FIELDS))
      pair(key, l[field] as number | boolean);
    for (const [prefix, line] of [
      ['0', l.innerLines],
      ['1', l.outerLines],
    ] as const)
      for (const [key, field] of Object.entries(LINE_FIELDS)) pair(prefix + key, line[field]);
  }
  out.push('S');
  color(p.sniper.color, 't');
  pair('d', p.sniper.bDisplayCenterDot);
  pair('s', p.sniper.centerDotSize);
  pair('o', p.sniper.centerDotOpacity);
  return out.join(';');
}
export interface CrosshairRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

export function crosshairRects(
  input: Crosshair,
  mode: 'primary' | 'ads' | 'sniper' = 'primary',
): CrosshairRect[] {
  const p = validateCrosshair(input),
    out: CrosshairRect[] = [];
  if (mode === 'sniper') {
    const s = p.sniper;
    return s.bDisplayCenterDot && s.centerDotSize > 0
      ? [
          {
            x: -s.centerDotSize / 2,
            y: -s.centerDotSize / 2,
            width: s.centerDotSize,
            height: s.centerDotSize,
            color: s.color,
            opacity: s.centerDotOpacity,
          },
        ]
      : [];
  }
  const l =
    mode === 'ads' && p.bUseAdvancedOptions && !p.bUsePrimaryCrosshairForADS ? p.aDS : p.primary;
  const add = (x: number, y: number, width: number, height: number, opacity: number) => {
    if (!width || !height || !opacity) return;
    const t = l.bHasOutline ? l.outlineThickness : 0;
    if (t && l.outlineOpacity)
      out.push({
        x: x - t,
        y: y - t,
        width: width + 2 * t,
        height: height + 2 * t,
        color: l.outlineColor,
        opacity: l.outlineOpacity,
      });
    out.push({ x, y, width, height, color: l.color, opacity });
  };
  for (const a of [l.outerLines, l.innerLines])
    if (a.bShowLines) {
      const t = a.lineThickness,
        h = a.lineLength,
        v = a.bAllowVertScaling ? a.lineLengthVertical : h,
        o = a.lineOffset;
      add(o, -t / 2, h, t, a.opacity);
      add(-o - h, -t / 2, h, t, a.opacity);
      add(-t / 2, o, t, v, a.opacity);
      add(-t / 2, -o - v, t, v, a.opacity);
    }
  if (l.bDisplayCenterDot)
    add(
      -l.centerDotSize / 2,
      -l.centerDotSize / 2,
      l.centerDotSize,
      l.centerDotSize,
      l.centerDotOpacity,
    );
  return out;
}
