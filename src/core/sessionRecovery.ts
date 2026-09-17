import type { Section, Snapshot } from './types';
const SESSION_CODES = new Set([
  'SESSION_EXPIRED',
  'RENEWAL_WAIT',
  'RENEWAL_IN_PROGRESS',
  'AUTH_UNAVAILABLE',
]);
const SETUP_CODES = new Set([...SESSION_CODES, 'NETWORK', 'TIMEOUT', 'SERVICE_UNAVAILABLE']);
export function sessionSectionNeedsRecovery(value: Section<unknown> | undefined): boolean {
  const issue = value?.status === 'error' ? value : value?.warning;
  return !!issue && SESSION_CODES.has(issue.code);
}
export function needsSessionRecovery(snapshot: Snapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.refreshIssue && SETUP_CODES.has(snapshot.refreshIssue.code)) return true;
  return [
    snapshot.store,
    snapshot.wallet,
    snapshot.rank,
    snapshot.xp,
    snapshot.progression,
    snapshot.collection,
    snapshot.loadout,
    snapshot.matches,
  ].some(sessionSectionNeedsRecovery);
}
