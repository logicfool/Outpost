import type { PlayerRef } from './playerTypes';
import { AppError, uuid } from './validation';

export class PlayerScope {
  private players = new Map<
    string,
    { player: PlayerRef; source: 'match' | 'friend' | 'account' }
  >();
  private matches = new Map<string, Set<string>>();
  constructor(
    readonly self: string,
    name = 'You',
    tag = '',
  ) {
    this.players.set(uuid(self), { player: { subject: self, name, tag }, source: 'account' });
  }
  remember(player: PlayerRef, source: 'match' | 'friend' = 'match'): void {
    const id = uuid(player.subject);
    if (player.hidden && id !== this.self) return;
    if (this.players.size >= 1500 && !this.players.has(id)) {
      const oldest = [...this.players.keys()].find((key) => key !== this.self);
      if (oldest) this.players.delete(oldest);
    }
    const old = this.players.get(id);
    this.players.set(id, {
      player: { ...old?.player, ...player, subject: id },
      source: id === this.self ? 'account' : source,
    });
  }
  player(id: string) {
    const entry = this.players.get(uuid(id));
    if (!entry || entry.player.hidden)
      throw new AppError(
        'PROFILE_SCOPE',
        'Open a visible player from a loaded match or your friends list.',
      );
    return entry;
  }
  allowMatch(subject: string, matchId: string): void {
    this.player(subject);
    const id = uuid(matchId);
    if (this.matches.size >= 2000 && !this.matches.has(id))
      this.matches.delete(this.matches.keys().next().value!);
    const viewers = this.matches.get(id) ?? new Set<string>();
    viewers.add(subject);
    this.matches.set(id, viewers);
  }
  allowsMatch(subject: string, id: string) {
    return this.matches.get(uuid(id))?.has(uuid(subject)) === true;
  }
}
