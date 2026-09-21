import { useCallback, useEffect, useReducer, useState } from 'react';
import { AppState } from 'react-native';
import type { AppModel } from './useApp';
import type { LiveGame, Section } from '../core/types';
import type { LivePlayer } from '../core/playerTypes';
import type { LiveEquipment } from '../core/matchTypes';
import type { LiveRankEntry, LiveViewState } from '../core/livePresentation';
import { retainedLiveScore } from '../core/livePresentation';
import { ownLiveProgress, progressLabel, hasScorePair } from '../core/liveProgress';
import { safeError } from '../core/validation';
import { keepCached } from '../core/refreshPolicy';

export function useLiveScore(model: AppModel, view: LiveViewState) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') setNow(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const current = ownLiveProgress(
    game,
    model.chat.selfPresence,
    model.chat.status === 'ready',
    Math.max(now, Date.now()),
    model.chat.friends,
  );
  const scoped = view.accountId === model.active?.puuid && view.matchId === game?.matchId;
  const progress = scoped ? retainedLiveScore(view, game, current) : undefined;
  const live = hasScorePair(current) && !!progressLabel(current, Math.max(now, Date.now()));
  return { progress, live, now: Math.max(now, Date.now()) };
}

async function loadRank(
  model: AppModel,
  player: LivePlayer,
  view: LiveViewState,
): Promise<LiveRankEntry> {
  const previous = view.ranks[player.subject],
    old = view.rankFlights.get(player.subject);
  if (old) return old;
  if ((view.rankBlockedUntil ?? 0) > Date.now())
    return (
      previous ?? {
        checkedAt: Date.now(),
        issue: 'Rank checks are waiting for Riot.',
        retryAt: view.rankBlockedUntil,
      }
    );
  if (previous && (Date.now() - previous.checkedAt < 60000 || (previous.retryAt ?? 0) > Date.now()))
    return previous;
  const work = (async () => {
    let entry: LiveRankEntry;
    try {
      entry = { data: await model.playerRank(player), checkedAt: Date.now() };
    } catch (reason) {
      const error = safeError(reason);
      entry = {
        ...previous,
        checkedAt: Date.now(),
        issue: error.message,
        code: error.code,
        retryAt:
          error.retryAt ??
          (['RATE_LIMIT', 'ACCESS_DENIED', 'SESSION_EXPIRED', 'NETWORK', 'TIMEOUT'].includes(
            error.code,
          )
            ? Date.now() + 60000
            : undefined),
      };
    }
    if (entry.retryAt) view.rankBlockedUntil = Math.max(view.rankBlockedUntil ?? 0, entry.retryAt);
    view.ranks[player.subject] = entry;
    return entry;
  })();
  view.rankFlights.set(player.subject, work);
  try {
    return await work;
  } finally {
    if (view.rankFlights.get(player.subject) === work) view.rankFlights.delete(player.subject);
  }
}
export function useLiveRanks(
  model: AppModel,
  players: readonly LivePlayer[],
  view: LiveViewState,
  includeKnown = false,
) {
  const [, redraw] = useReducer((n) => n + 1, 0),
    [loading, setLoading] = useState(true),
    [revision, refresh] = useReducer((n) => n + 1, 0);
  const key = players
    .filter((p) => !p.hidden)
    .map((p) => p.subject)
    .join(':');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      for (const player of players) {
        if (!alive || view.accountId !== model.active?.puuid) return;
        if (player.hidden || (!includeKnown && player.tier != null)) continue;
        const result = await loadRank(model, player, view);
        if (alive) redraw();
        if ((result.retryAt ?? 0) > Date.now()) break;
      }
    })().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [model.active?.puuid, model.playerRank, key, view, includeKnown, revision]);
  return {
    ranks: Object.fromEntries(
      Object.entries(view.ranks)
        .filter(([, v]) => v.data)
        .map(([id, v]) => [id, v.data!]),
    ),
    loading,
    refresh,
  };
}
export function useLiveLoadout(
  model: AppModel,
  matchId: string,
  view: LiveViewState,
  enabled = true,
) {
  const [state, setState] = useState<{ view: LiveViewState; data?: Section<LiveEquipment> }>({
      view,
      data: view.equipment,
    }),
    [busy, setBusy] = useState(false),
    [revision, refresh] = useReducer((n) => n + 1, 0);
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const valid =
    enabled &&
    view.accountId === model.active?.puuid &&
    view.matchId === matchId &&
    game?.matchId === matchId &&
    ['in_game', 'agent_select'].includes(game.state);
  useEffect(() => {
    let alive = true;
    if (!valid) {
      setBusy(false);
      return;
    }
    const saved = view.equipment;
    if (
      !revision &&
      saved?.status === 'ready' &&
      saved.data.matchId === matchId &&
      Date.now() - saved.fetchedAt < 60000
    ) {
      setState({ view, data: saved });
      return;
    }
    setBusy(true);
    void model
      .liveEquipment(matchId)
      .then((next) => {
        if (!alive) return;
        if (next.status === 'ready' && next.data.matchId !== matchId)
          next = {
            status: 'error',
            code: 'MATCH_CHANGED',
            message: 'This match changed. Return to the current roster.',
          };
        const value = keepCached(view.equipment, next);
        view.equipment = value;
        setState({ view, data: value });
      })
      .catch((reason) => {
        if (!alive) return;
        const e = safeError(reason),
          value = keepCached(view.equipment, {
            status: 'error',
            code: e.code,
            message: e.message,
            retryAt: e.retryAt,
          });
        view.equipment = value;
        setState({ view, data: value });
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [model.active?.puuid, model.liveEquipment, matchId, view, valid, revision]);
  const data = state.view === view ? state.data : view.equipment;
  const scopedData =
    valid && (data?.status !== 'ready' || data.data.matchId === matchId) ? data : undefined;
  return { data: scopedData, busy, refresh: useCallback(() => refresh(), []), valid };
}
