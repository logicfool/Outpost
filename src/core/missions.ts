import type { Catalog } from './types';
import type {
  Mission,
  MissionBoard,
  MissionDefinition,
  MissionKind,
  MissionObjective,
  MissionWeek,
} from './missionTypes';
import { array, number, object, text, timestamp } from './validation';

const KINDS: Record<string, MissionKind> = {
  daily: 'daily',
  weekly: 'weekly',
  npe: 'npe',
  tutorial: 'tutorial',
  bte: 'bte',
};
export function missionKind(raw: unknown): MissionKind {
  const name = text(raw).split('::').pop()?.toLowerCase() ?? '';
  return KINDS[name] ?? 'other';
}

export function missionSchedule(assetPath: string): {
  group?: string;
  week?: number;
  season?: string;
} {
  const match = /\/([A-Za-z0-9-]+)_Weeklies\/Week(\d{1,3})\//.exec(assetPath);
  if (!match) return {};
  return { season: match[1], week: Number(match[2]), group: `${match[1]}:${match[2]}` };
}

export function missionDefinitions(raw: unknown): Record<string, MissionDefinition> {
  const result: Record<string, MissionDefinition> = Object.create(null);
  for (const value of array(object(raw).data)) {
    const m = object(value),
      id = text(m.uuid).toLowerCase();
    if (!id || id === '__proto__') continue;
    const objectives = array(m.objectives)
      .map(object)
      .map((o) => ({ id: text(o.objectiveUuid).toLowerCase(), target: number(o.value) }))
      .filter((o) => !!o.id);
    const activatesAt = timestamp(m.activationDate),
      expiresAt = timestamp(m.expirationDate);
    result[id] = {
      id,
      title: text(m.title) || text(m.displayName) || `Mission · ${id.slice(0, 8)}`,
      kind: missionKind(m.type),
      xpGrant: number(m.xpGrant),
      target: number(m.progressToComplete, 1),
      objectives,
      ...(activatesAt ? { activatesAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...missionSchedule(text(m.assetPath)),
    };
  }
  return result;
}
export function objectiveDirectives(raw: unknown): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const value of array(object(raw).data)) {
    const o = object(value),
      id = text(o.uuid).toLowerCase(),
      directive = text(o.directive);
    if (id && id !== '__proto__' && directive) result[id] = directive;
  }
  return result;
}

export function renderDirective(template: string, count: number): string {
  return template
    .replace(/\{Num\}\|plural\(([^)]*)\)/g, (_, forms: string) => {
      const options = new Map(
        forms.split(',').map((part) => {
          const [key, value] = part.split('=');
          return [key?.trim() ?? '', value?.trim() ?? ''] as const;
        }),
      );
      return (
        options.get(count === 1 ? 'one' : 'other') ??
        options.get('other') ??
        options.values().next().value ??
        ''
      );
    })
    .replace(/\{Num\}/g, String(count))
    .trim();
}

function describe(
  definition: MissionDefinition | undefined,
  objectiveId: string,
  directives: Record<string, string>,
  target: number,
): string {
  const template = Object.hasOwn(directives, objectiveId) ? directives[objectiveId]! : '';
  if (template) return renderDirective(template, target);
  return definition?.title ?? 'Objective';
}

export function buildMission(
  entry: { id: string; complete: boolean; expiresAt?: number; objectives: Record<string, number> },
  catalog: Catalog,
  now = Date.now(),
): Mission {
  const definition = catalog.missions?.[entry.id.toLowerCase()];
  const directives = catalog.objectives ?? {};
  const ids = definition?.objectives.length
    ? definition.objectives.map((o) => o.id)
    : Object.keys(entry.objectives);
  const objectives: MissionObjective[] = ids.map((id) => {
    const target =
      definition?.objectives.find((o) => o.id === id)?.target ?? definition?.target ?? 1;
    const progress = number(entry.objectives[id]);
    return {
      id,
      directive: describe(definition, id, directives, target),
      progress: Math.min(progress, target),
      target,
    };
  });
  const target = objectives.reduce((sum, o) => sum + o.target, 0) || definition?.target || 1;
  const progress = objectives.reduce((sum, o) => sum + o.progress, 0);
  return {
    id: entry.id,
    title: definition?.title ?? `Mission · ${entry.id.slice(0, 8)}`,
    kind: definition?.kind ?? 'other',
    complete: entry.complete,
    expiresAt:
      entry.expiresAt ??
      (definition?.expiresAt && definition.expiresAt > now ? definition.expiresAt : undefined),
    progress: entry.complete ? target : progress,
    target,
    xpGrant: definition?.xpGrant || undefined,
    objectives,
    unresolved: !definition,
  };
}

const weekLabel = (definition: MissionDefinition) =>
  definition.week ? `Week ${definition.week}` : 'Scheduled';

export function missionBoard(
  entries: {
    id: string;
    complete: boolean;
    expiresAt?: number;
    objectives: Record<string, number>;
  }[],
  metadata: { weeklyRefillAt?: number; weeklyCheckpointAt?: number; npeCompleted?: boolean },
  catalog: Catalog,
  now = Date.now(),
): MissionBoard {
  const missions = entries.map((entry) => buildMission(entry, catalog, now));
  const active = new Set(missions.map((m) => m.id.toLowerCase()));
  const definitions = Object.values(catalog.missions ?? {});

  const queued = definitions
    .filter(
      (d) =>
        d.kind === 'weekly' &&
        !active.has(d.id) &&
        d.activatesAt !== undefined &&
        d.activatesAt <= now &&
        (d.expiresAt === undefined || d.expiresAt > now),
    )
    .sort((a, b) => (a.week ?? 0) - (b.week ?? 0) || a.title.localeCompare(b.title));

  const weeks = new Map<string, MissionWeek>();
  for (const definition of definitions) {
    if (
      definition.kind !== 'weekly' ||
      definition.activatesAt === undefined ||
      definition.activatesAt <= now
    )
      continue;
    const group = definition.group ?? `date:${definition.activatesAt}`;
    const week = weeks.get(group) ?? {
      group,
      label: weekLabel(definition),
      activatesAt: definition.activatesAt,
      expiresAt: definition.expiresAt,
      missions: [],
    };
    week.activatesAt = Math.min(week.activatesAt ?? definition.activatesAt, definition.activatesAt);
    if (definition.expiresAt !== undefined)
      week.expiresAt = Math.max(week.expiresAt ?? definition.expiresAt, definition.expiresAt);
    week.missions.push(definition);
    weeks.set(group, week);
  }
  const upcoming = [...weeks.values()]
    .map((week) => ({
      ...week,
      missions: [...week.missions].sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => (a.activatesAt ?? 0) - (b.activatesAt ?? 0));

  const daily = missions.filter((m) => m.kind === 'daily');
  return {
    daily,
    weekly: missions.filter((m) => m.kind === 'weekly'),
    other: missions.filter((m) => m.kind !== 'daily' && m.kind !== 'weekly'),
    queued,
    upcoming,
    dailyResetAt: daily
      .map((m) => m.expiresAt)
      .filter((v): v is number => !!v)
      .sort((a, b) => a - b)[0],
    weeklyRefillAt: metadata.weeklyRefillAt,
    weeklyCheckpointAt: metadata.weeklyCheckpointAt,
    npeCompleted: metadata.npeCompleted,
  };
}
