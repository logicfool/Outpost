export type MissionKind = 'daily' | 'weekly' | 'npe' | 'tutorial' | 'bte' | 'other';
export interface MissionObjectiveDefinition {
  id: string;
  target: number;
}
export interface MissionDefinition {
  id: string;
  title: string;
  kind: MissionKind;
  xpGrant: number;
  target: number;
  objectives: MissionObjectiveDefinition[];
  activatesAt?: number;
  expiresAt?: number;

  group?: string;
  week?: number;
  season?: string;
}
export interface MissionObjective {
  id: string;
  directive: string;
  progress: number;
  target: number;
}
export interface Mission {
  id: string;
  title: string;
  kind: MissionKind;
  complete: boolean;
  expiresAt?: number;
  progress: number;
  target: number;
  xpGrant?: number;
  objectives: MissionObjective[];

  unresolved: boolean;
}
export interface MissionWeek {
  group: string;
  label: string;
  activatesAt?: number;
  expiresAt?: number;
  missions: MissionDefinition[];
}
export interface MissionBoard {
  active: Mission[];
  todo: number;
  done: MissionDefinition[];
  upcoming: MissionWeek[];
  weeklyRefillAt?: number;
  weeklyCheckpointAt?: number;
  npeCompleted?: boolean;
}
