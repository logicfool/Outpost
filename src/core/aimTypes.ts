import type { Crosshair } from './crosshair';
export interface Sensitivity {
  hipfire: number | null;
  ads: number | null;
  scoped: number | null;
}
export interface AimSnapshot {
  accountId: string;
  fetchedAt: number;
  modified?: number;
  revision: string;
  sensitivity: Sensitivity;
  crosshairs: { index: number; name: string; profile?: Crosshair; issue?: string }[];
  current: number | null;
}
export interface AimEdit {
  expectedRevision: string;
  sensitivity?: Partial<Sensitivity>;
  crosshair?: { profile: Crosshair; index?: number; select: boolean };
}
export interface AimPreset {
  id: string;
  accountId: string;
  name: string;
  profile: Crosshair;
  sensitivity: Sensitivity;
  updatedAt: number;
}
export interface AimPending {
  id: string;
  at: number;
  desired: AimEdit;
}
export interface AimState {
  snapshot?: AimSnapshot;
  attemptedAt?: number;
  nextReadAt?: number;
  lastApplyAt?: number;
  needsSync?: boolean;
  error?: { code: string; message: string; retryAt?: number };
  pending?: AimPending;
}
export interface AimStore {
  aimState(id: string): Promise<AimState | null>;
  saveAimState(id: string, state: AimState): Promise<void>;
  aimPresets(id: string): Promise<AimPreset[]>;
  saveAimPreset(preset: AimPreset): Promise<void>;
  deleteAimPreset(id: string, presetId: string): Promise<void>;
}
export interface AimDocument {
  data: Record<string, unknown>;
  modified?: number;
}
export const AIM_READ_INTERVAL = 60000;
export const AIM_MAX_PROFILES = 15;
