import { AppError, object, uuid } from './validation';
import {
  colorHex,
  defaultCrosshair,
  validateCrosshair,
  crosshairName,
  type Crosshair,
  type CrosshairLayer,
  type CrosshairLines,
} from './crosshair';
import {
  AIM_MAX_PROFILES,
  type AimDocument,
  type AimSnapshot,
  type AimEdit,
  type Sensitivity,
  type AimPreset,
} from './aimTypes';
import { inspectAimJson } from './aimCodec';
const CROSSHAIRS = 'EAresStringSettingName::SavedCrosshairProfileData';
export const SENSITIVITY_KEYS = {
  hipfire: 'MouseSensitivity',
  ads: 'MouseSensitivityADS',
  scoped: 'MouseSensitivityZoomed',
} as const;
type Row = Record<string, unknown>;
const aliases = (key: string) =>
  key === 'aDS' ? ['aDS', 'ads', 'ADS'] : [key, key[0]!.toUpperCase() + key.slice(1)];
const get = (row: Row, key: string) => {
  const values = aliases(key)
    .filter((k) => Object.hasOwn(row, k))
    .map((k) => row[k]);
  if (values.length > 1 && !values.every((v) => equivalentAimValue(v, values[0])))
    throw new AppError('AIM_SCHEMA', 'Conflicting crosshair field aliases.');
  return values.find((v) => v !== undefined);
};
const put = (row: Row, key: string, value: unknown) => {
  const keyName = aliases(key).find((k) => Object.hasOwn(row, k)) ?? key;
  row[keyName] = value;
};
function rows(data: Row, kind: string): Row[] {
  const list = data[kind];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new AppError('AIM_SCHEMA', 'Settings entries are malformed.');
  return list.map((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new AppError('AIM_SCHEMA', 'Settings entry is malformed.');
    return v as Row;
  });
}
function entry(data: Row, kind: string, key: string): Row | undefined {
  const matches = rows(data, kind).filter((e) => e.settingEnum === key);
  if (matches.length > 1) throw new AppError('AIM_SCHEMA', 'Riot returned duplicate aim settings.');
  return matches[0];
}
function upsert(
  data: Row,
  kind: 'floatSettings' | 'boolSettings' | 'stringSettings',
  key: string,
  value: unknown,
) {
  const item = entry(data, kind, key);
  if (item) item.value = value;
  else {
    const list = rows(data, kind);
    list.push({ settingEnum: key, value });
    data[kind] = list;
  }
}
function rgba(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  const c = object(value),
    components = ['r', 'g', 'b', 'a'].map((k) => get(c, k));
  if (
    components
      .slice(0, 3)
      .some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw new AppError('AIM_SCHEMA', 'Unsupported crosshair colour.');
  const a = components[3] ?? 255;
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a > 255)
    throw new AppError('AIM_SCHEMA', 'Unsupported crosshair alpha.');
  return [...components.slice(0, 3), a]
    .map((v) => (v as number).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
function colorObject(hex: string, old: unknown): Row {
  const r = { ...object(old) },
    c = colorHex(hex);
  for (const [i, k] of ['r', 'g', 'b', 'a'].entries())
    put(r, k, parseInt(c.slice(i * 2, i * 2 + 2), 16));
  return r;
}
export function crosshairFromRiot(value: unknown, index = 0): Crosshair {
  const r = object(value);
  if (!get(r, 'primary') || typeof get(r, 'primary') !== 'object')
    throw new AppError('AIM_SCHEMA', 'Unsupported crosshair profile.');
  const d = defaultCrosshair(
    typeof get(r, 'profileName') === 'string'
      ? (get(r, 'profileName') as string)
      : `Profile ${index + 1}`,
  );
  const line = (raw: unknown, base: CrosshairLines): CrosshairLines => {
    const out = { ...base },
      o = object(raw);
    for (const k of Object.keys(base) as (keyof CrosshairLines)[])
      if (get(o, k) !== undefined) Object.assign(out, { [k]: get(o, k) });
    if (!out.bAllowVertScaling) out.lineLengthVertical = out.lineLength;
    return out;
  };
  const layer = (raw: unknown, base: CrosshairLayer): CrosshairLayer => {
    const o = object(raw),
      out = { ...base };
    for (const k of Object.keys(base) as (keyof CrosshairLayer)[])
      if (
        !['color', 'outlineColor', 'innerLines', 'outerLines'].includes(k) &&
        get(o, k) !== undefined
      )
        Object.assign(out, { [k]: get(o, k) });
    out.color = rgba(
      get(o, get(o, 'bUseCustomColor') === true ? 'colorCustom' : 'color'),
      base.color,
    );
    out.outlineColor = rgba(get(o, 'outlineColor'), base.outlineColor);
    out.innerLines = line(get(o, 'innerLines'), base.innerLines);
    out.outerLines = line(get(o, 'outerLines'), base.outerLines);
    return out;
  };
  d.primary = layer(get(r, 'primary'), d.primary);
  d.aDS = layer(get(r, 'aDS'), d.aDS);
  const s = object(get(r, 'sniper'));
  d.sniper.color = rgba(
    get(s, get(s, 'bUseCustomCenterDotColor') === true ? 'centerDotColorCustom' : 'centerDotColor'),
    d.sniper.color,
  );
  for (const k of ['centerDotSize', 'centerDotOpacity', 'bDisplayCenterDot'] as const)
    if (get(s, k) !== undefined) Object.assign(d.sniper, { [k]: get(s, k) });
  for (const k of [
    'bUseAdvancedOptions',
    'bUsePrimaryCrosshairForADS',
    'bUseCustomCrosshairOnAllPrimary',
  ] as const)
    if (get(r, k) !== undefined) Object.assign(d, { [k]: get(r, k) });
  return validateCrosshair(d);
}

export function crosshairToRiot(profile: Crosshair, previous: unknown = {}): Row {
  const p = validateCrosshair(profile),
    out = JSON.parse(JSON.stringify(object(previous))) as Row;
  const line = (value: CrosshairLines, old: unknown) => {
    const target = { ...object(old) };
    for (const [k, v] of Object.entries(value)) put(target, k, v);
    return target;
  };
  const layer = (value: CrosshairLayer, old: unknown) => {
    const target = { ...object(old) };
    for (const [k, v] of Object.entries(value)) {
      if (k === 'color' || k === 'outlineColor')
        put(target, k, colorObject(v as string, get(target, k)));
      else if (k === 'innerLines' || k === 'outerLines')
        put(target, k, line(v as CrosshairLines, get(target, k)));
      else put(target, k, v);
    }
    put(target, 'bUseCustomColor', true);
    put(target, 'colorCustom', colorObject(value.color, get(target, 'colorCustom')));
    return target;
  };
  put(out, 'profileName', p.profileName);
  put(out, 'primary', layer(p.primary, get(out, 'primary')));
  put(out, 'aDS', layer(p.aDS, get(out, 'aDS')));
  const sniper = { ...object(get(out, 'sniper')) };
  for (const [k, v] of Object.entries(p.sniper)) if (k !== 'color') put(sniper, k, v);
  put(sniper, 'bUseCustomCenterDotColor', true);
  put(sniper, 'centerDotColor', colorObject(p.sniper.color, get(sniper, 'centerDotColor')));
  put(
    sniper,
    'centerDotColorCustom',
    colorObject(p.sniper.color, get(sniper, 'centerDotColorCustom')),
  );
  put(out, 'sniper', sniper);
  for (const k of [
    'bUseAdvancedOptions',
    'bUsePrimaryCrosshairForADS',
    'bUseCustomCrosshairOnAllPrimary',
  ] as const)
    put(out, k, p[k]);
  return out;
}
function profileList(data: Row): { raw: Row; profiles: unknown[]; current: number | null } {
  const stored = entry(data, 'stringSettings', CROSSHAIRS);
  if (!stored) return { raw: { currentProfile: 0, profiles: [] }, profiles: [], current: null };
  if (typeof stored.value !== 'string' || stored.value.length > 180000)
    throw new AppError('AIM_SCHEMA', 'The crosshair library is invalid.');
  let raw: Row;
  try {
    raw = object(JSON.parse(stored.value));
  } catch {
    throw new AppError('AIM_SCHEMA', 'The crosshair library could not be read.');
  }
  inspectAimJson({ floatSettings: [], stringSettings: [], profileData: raw });
  const profiles = get(raw, 'profiles'),
    current = get(raw, 'currentProfile');
  if (
    !Array.isArray(profiles) ||
    profiles.length > AIM_MAX_PROFILES ||
    !Number.isInteger(current) ||
    Number(current) < 0 ||
    (profiles.length ? Number(current) >= profiles.length : Number(current) !== 0)
  )
    throw new AppError('AIM_SCHEMA', 'The crosshair profile selection is invalid.');
  return { raw, profiles, current: profiles.length ? Number(current) : null };
}
export function validateSensitivity(
  value: Partial<Sensitivity>,
  complete = false,
): Partial<Sensitivity> {
  const out: Partial<Sensitivity> = {};
  for (const key of Object.keys(SENSITIVITY_KEYS) as (keyof Sensitivity)[]) {
    const v = value[key];
    if (v === undefined) {
      if (complete) throw new AppError('SENSITIVITY', 'Enter all three sensitivity settings.');
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.001 || v > 10)
      throw new AppError('SENSITIVITY', 'Sensitivity must be between 0.001 and 10.');
    out[key] = v;
  }
  return out;
}
export function aimSnapshot(doc: AimDocument, id: string, now = Date.now()): AimSnapshot {
  inspectAimJson(doc.data);
  const list = profileList(doc.data),
    sensitivity: Sensitivity = { hipfire: null, ads: null, scoped: null };
  for (const key of Object.keys(SENSITIVITY_KEYS) as (keyof Sensitivity)[]) {
    const row = entry(doc.data, 'floatSettings', 'EAresFloatSettingName::' + SENSITIVITY_KEYS[key]);
    if (row) {
      if (
        typeof row.value !== 'number' ||
        !Number.isFinite(row.value) ||
        row.value < 0 ||
        row.value > 10
      )
        throw new AppError('AIM_SCHEMA', 'Unsupported sensitivity value.');
      sensitivity[key] = row.value;
    }
  }
  const crosshairs = list.profiles.map((p, index) => {
    const name =
      typeof get(object(p), 'profileName') === 'string'
        ? String(get(object(p), 'profileName')).slice(0, 48)
        : `Profile ${index + 1}`;
    try {
      return { index, name, profile: crosshairFromRiot(p, index) };
    } catch {
      return { index, name, issue: 'This profile has unsupported settings.' };
    }
  });
  const revision = JSON.stringify([
    sensitivity,
    entry(doc.data, 'stringSettings', CROSSHAIRS)?.value ?? null,
  ]);
  return {
    accountId: uuid(id),
    fetchedAt: now,
    modified: doc.modified,
    revision,
    sensitivity,
    crosshairs,
    current: list.current,
  };
}
export function validateAimEdit(edit: AimEdit): AimEdit {
  if (!edit || typeof edit.expectedRevision !== 'string' || edit.expectedRevision.length > 200000)
    throw new AppError('AIM_EDIT', 'Refresh settings before applying.');
  const sensitivity = edit.sensitivity ? validateSensitivity(edit.sensitivity) : undefined;
  if (!edit.crosshair && !Object.keys(sensitivity ?? {}).length)
    throw new AppError('AIM_EDIT', 'No changes selected.');
  const c = edit.crosshair;
  if (
    c &&
    (typeof c.select !== 'boolean' ||
      (c.index !== undefined &&
        (!Number.isInteger(c.index) || c.index < 0 || c.index >= AIM_MAX_PROFILES)))
  )
    throw new AppError('AIM_EDIT', 'The selected crosshair slot is invalid.');
  return {
    expectedRevision: edit.expectedRevision,
    ...(sensitivity ? { sensitivity } : {}),
    ...(c
      ? { crosshair: { index: c.index, select: c.select, profile: validateCrosshair(c.profile) } }
      : {}),
  };
}
function mirrorActive(data: Row, p: Crosshair): void {
  const color = (hex: string) => {
    const c = colorHex(hex);
    return `(R=${parseInt(c.slice(0, 2), 16)},G=${parseInt(c.slice(2, 4), 16)},B=${parseInt(c.slice(4, 6), 16)},A=${parseInt(c.slice(6, 8), 16)})`;
  };
  const write = (
    kind: 'floatSettings' | 'boolSettings' | 'stringSettings',
    name: string,
    value: unknown,
    existingOnly = false,
  ) => {
    const key = `EAres${kind === 'floatSettings' ? 'Float' : kind === 'boolSettings' ? 'Bool' : 'String'}SettingName::${name}`;
    if (!existingOnly || entry(data, kind, key)) upsert(data, kind, key, value);
  };
  write('stringSettings', 'CrosshairProfileName', p.profileName);
  write('boolSettings', 'FadeCrosshairWithFiringError', p.primary.bFadeCrosshairWithFiringError);
  write('boolSettings', 'CrosshairUseAdvancedOptions', p.bUseAdvancedOptions);
  write('boolSettings', 'CrosshairUsePrimaryCrosshairForADS', p.bUsePrimaryCrosshairForADS);
  write(
    'boolSettings',
    'CrosshairUseCustomCrosshairOnAllPrimary',
    p.bUseCustomCrosshairOnAllPrimary,
  );
  for (const [prefix, l] of [
    ['Crosshair', p.primary],
    ['CrosshairADS', p.aDS],
  ] as const) {
    for (const [suffix, value] of Object.entries({
      Color: color(l.color),
      ColorCustom: color(l.color),
      OutlineColor: color(l.outlineColor),
    }))
      write('stringSettings', prefix + suffix, value);
    write('boolSettings', prefix + 'UseCustomColor', true);
    for (const [suffix, value] of Object.entries({
      HasOutline: l.bHasOutline,
      DisplayCenterDot: l.bDisplayCenterDot,
    }))
      write('boolSettings', prefix + suffix, value, true);
    for (const [suffix, value] of Object.entries({
      OutlineThickness: l.outlineThickness,
      OutlineOpacity: l.outlineOpacity,
      CenterDotSize: l.centerDotSize,
      CenterDotOpacity: l.centerDotOpacity,
    }))
      write('floatSettings', prefix + suffix, value, true);
    for (const [part, line] of [
      ['InnerLines', l.innerLines],
      ['OuterLines', l.outerLines],
    ] as const) {
      for (const [key, value] of Object.entries(line)) {
        const suffix = key[0] === 'b' ? key.slice(1) : key[0]!.toUpperCase() + key.slice(1);
        write(
          typeof value === 'boolean' ? 'boolSettings' : 'floatSettings',
          prefix + part + suffix,
          value,
          true,
        );
      }
    }
  }
  write('stringSettings', 'CrosshairSniperCenterDotColor', color(p.sniper.color));
  write('stringSettings', 'CrosshairSniperCenterDotColorCustom', color(p.sniper.color));
  write('boolSettings', 'CrosshairSniperUseCustomColor', true);
  write('floatSettings', 'CrosshairSniperCenterDotSize', p.sniper.centerDotSize, true);
  write('floatSettings', 'CrosshairSniperCenterDotOpacity', p.sniper.centerDotOpacity, true);
  write('boolSettings', 'CrosshairSniperDisplayCenterDot', p.sniper.bDisplayCenterDot, true);
}
export function prepareAimDocument(doc: AimDocument, id: string, input: AimEdit): AimDocument {
  const edit = validateAimEdit(input),
    before = aimSnapshot(doc, id);
  if (before.revision !== edit.expectedRevision)
    throw new AppError(
      'AIM_CONFLICT',
      'Your aim settings changed. Refresh and review the changes.',
    );
  const data = JSON.parse(JSON.stringify(doc.data)) as Row;
  if (edit.sensitivity)
    for (const [key, value] of Object.entries(edit.sensitivity))
      upsert(
        data,
        'floatSettings',
        'EAresFloatSettingName::' + SENSITIVITY_KEYS[key as keyof Sensitivity],
        value,
      );
  if (edit.crosshair) {
    const c = edit.crosshair,
      list = profileList(data);
    let index = c.index;
    if (index === undefined) {
      if (list.profiles.length >= AIM_MAX_PROFILES)
        throw new AppError(
          'AIM_PROFILE_LIMIT',
          'All 15 Riot crosshair slots are used. Select an existing slot to replace.',
        );
      index = list.profiles.length;
      list.profiles.push(crosshairToRiot(c.profile));
    } else {
      if (!list.profiles[index])
        throw new AppError('AIM_CONFLICT', 'The selected crosshair slot no longer exists.');
      list.profiles[index] = crosshairToRiot(c.profile, list.profiles[index]);
    }
    put(list.raw, 'profiles', list.profiles);
    if (c.select || list.current === null) {
      put(list.raw, 'currentProfile', index);
      mirrorActive(data, c.profile);
    } else if (index === list.current) mirrorActive(data, c.profile);
    upsert(data, 'stringSettings', CROSSHAIRS, JSON.stringify(list.raw));
  }
  inspectAimJson(data);
  return { data, modified: doc.modified };
}

export function equivalentAimValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.000001;
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>,
    keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((k) => Object.hasOwn(y, k) && equivalentAimValue(x[k], y[k]))
  );
}
export function aimEditMatches(snapshot: AimSnapshot, input: AimEdit): boolean {
  const edit = validateAimEdit(input);
  if (
    edit.sensitivity &&
    Object.entries(edit.sensitivity).some(
      ([key, value]) =>
        Math.abs((snapshot.sensitivity[key as keyof Sensitivity] ?? -99) - Number(value)) >
        0.000001,
    )
  )
    return false;
  if (edit.crosshair) {
    const c = edit.crosshair;
    const match =
      c.index === undefined
        ? snapshot.crosshairs.find(
            (p) =>
              (!c.select || p.index === snapshot.current) &&
              p.profile &&
              equivalentAimValue(p.profile, c.profile),
          )
        : snapshot.crosshairs.find((p) => p.index === c.index);
    if (
      !match?.profile ||
      !equivalentAimValue(match.profile, c.profile) ||
      (c.select && snapshot.current !== match.index)
    )
      return false;
  }
  return true;
}
export function validateAimPreset(value: AimPreset, accountId: string): AimPreset {
  if (uuid(value.accountId) !== uuid(accountId))
    throw new AppError('ACCOUNT_MISMATCH', 'This aim preset belongs to another account.');
  return {
    id: uuid(value.id),
    accountId: uuid(accountId),
    name: crosshairName(value.name),
    profile: validateCrosshair(value.profile),
    sensitivity: validateSensitivity(value.sensitivity, true) as Sensitivity,
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : Date.now(),
  };
}
