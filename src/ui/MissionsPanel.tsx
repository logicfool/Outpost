import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  Badge,
  Empty,
  ModalHeader,
  ModalPage,
  ProgressBar,
  Resource,
  SectionHeader,
  Tabs,
} from './components';
import { useTheme } from './theme';
import { missionBoard, renderDirective } from '../core/missions';
import type { Mission, MissionDefinition, MissionWeek } from '../core/missionTypes';
import type { Catalog, Progression } from '../core/types';
import type { AppModel } from '../state/useApp';

type Tab = 'daily' | 'weekly' | 'queued' | 'upcoming';

const day = (at?: number) =>
  at ? new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' }) : undefined;
const when = (at?: number) => {
  if (!at) return undefined;
  const ms = at - Date.now();
  if (ms <= 0) return 'now';
  const hours = Math.floor(ms / 3600000);
  return hours < 24 ? `${Math.max(1, hours)}h` : `${Math.floor(hours / 24)}d`;
};
const xp = (value?: number) => (value ? `+${value.toLocaleString()} XP` : undefined);

function MissionCard({ mission }: { mission: Mission }) {
  const { C, S } = useTheme();
  const pct = mission.target ? mission.progress / mission.target : 0;
  return (
    <View testID={`mission-${mission.id}`} style={[S.card, { gap: 10 }]}>
      <View style={[S.between, { alignItems: 'flex-start', gap: 10 }]}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={S.h3} numberOfLines={2}>
            {mission.title}
          </Text>
          {mission.unresolved && (
            <Text style={S.small}>Riot has not published this mission’s details yet.</Text>
          )}
        </View>
        {mission.complete ? (
          <Badge text="DONE" color={C.mint} />
        ) : (
          <Text style={[S.small, { fontVariant: ['tabular-nums'], color: C.subtle }]}>
            {xp(mission.xpGrant)}
          </Text>
        )}
      </View>
      {mission.objectives.map((objective) => (
        <View key={objective.id} style={{ gap: 6 }}>
          {mission.objectives.length > 1 || objective.directive !== mission.title ? (
            <Text style={S.body} numberOfLines={2}>
              {objective.directive}
            </Text>
          ) : null}
          <ProgressBar
            value={mission.complete ? objective.target : objective.progress}
            max={objective.target}
            color={mission.complete ? C.mint : undefined}
          />
          <View style={S.between}>
            <Text style={[S.small, { fontVariant: ['tabular-nums'] }]}>
              {(mission.complete ? objective.target : objective.progress).toLocaleString()} /{' '}
              {objective.target.toLocaleString()}
            </Text>
            <Text style={[S.small, { fontVariant: ['tabular-nums'] }]}>
              {Math.round(
                100 *
                  (mission.complete
                    ? 1
                    : Math.min(1, objective.progress / (objective.target || 1))),
              )}
              %
            </Text>
          </View>
        </View>
      ))}
      {!mission.objectives.length && (
        <ProgressBar
          value={mission.progress}
          max={mission.target}
          color={mission.complete ? C.mint : undefined}
        />
      )}
      {mission.expiresAt ? (
        <Text style={S.small}>
          Expires in {when(mission.expiresAt)} · {day(mission.expiresAt)}
        </Text>
      ) : null}
      {pct >= 1 && !mission.complete ? (
        <Text style={[S.small, { color: C.gold }]}>Riot has not marked this complete yet.</Text>
      ) : null}
    </View>
  );
}

function DefinitionCard({ definition, note }: { definition: MissionDefinition; note?: string }) {
  const { C, S } = useTheme();
  const directive = definition.objectives[0];
  return (
    <View testID={`mission-preview-${definition.id}`} style={[S.card, { gap: 6 }]}>
      <View style={[S.between, { gap: 10, alignItems: 'flex-start' }]}>
        <Text style={[S.h3, { flex: 1 }]} numberOfLines={2}>
          {definition.title}
        </Text>
        <Text style={[S.small, { fontVariant: ['tabular-nums'] }]}>{xp(definition.xpGrant)}</Text>
      </View>
      <Text style={S.body}>Target {(directive?.target ?? definition.target).toLocaleString()}</Text>
      {note ? <Text style={S.small}>{note}</Text> : null}
    </View>
  );
}

function WeekSelector({
  weeks,
  value,
  onChange,
}: {
  weeks: MissionWeek[];
  value: string;
  onChange(group: string): void;
}) {
  const { C, S } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
    >
      {weeks.map((week) => {
        const selected = week.group === value;
        return (
          <Pressable
            key={week.group}
            testID={`mission-week-${week.group}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${week.label}, unlocks ${day(week.activatesAt) ?? 'later'}`}
            onPress={() => onChange(week.group)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 14,
              borderWidth: 1,
              alignItems: 'center',
              gap: 2,
              borderColor: selected ? C.accent : C.border,
              backgroundColor: selected ? `${C.accent}16` : C.surface,
            }}
          >
            <Text style={[S.small, { fontWeight: '700', color: selected ? C.ink : C.subtle }]}>
              {week.label}
            </Text>
            <Text style={[S.small, { fontSize: 10 }]}>{day(week.activatesAt)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function MissionsView({
  progression,
  catalog,
}: {
  progression: Progression;
  catalog: Catalog;
}) {
  const { C, S } = useTheme();
  const board = useMemo(
    () => missionBoard(progression.missions, progression, catalog),
    [progression, catalog],
  );
  const [tab, setTab] = useState<Tab>('daily');
  const [week, setWeek] = useState<string | null>(null);

  const tabs = [
    { id: 'daily' as const, label: 'Daily', count: board.daily.length },
    { id: 'weekly' as const, label: 'Weekly', count: board.weekly.length },
    { id: 'queued' as const, label: 'Queued', count: board.queued.length },
    { id: 'upcoming' as const, label: 'Upcoming', count: board.upcoming.length },
  ].filter((item) => item.count > 0 || item.id === 'daily' || item.id === 'weekly');

  const selected = board.upcoming.find((w) => w.group === week) ?? board.upcoming[0];
  const completedDaily = board.daily.filter((m) => m.complete).length;
  const completedWeekly = board.weekly.filter((m) => m.complete).length;

  return (
    <View style={{ gap: 14 }}>
      <View style={[S.card, { gap: 12 }]}>
        <View style={S.between}>
          <View style={{ gap: 3 }}>
            <Text style={S.small}>DAILY CHECKPOINTS</Text>
            <Text style={S.h2}>
              {completedDaily} of {board.daily.length || '-'} complete
            </Text>
          </View>
          <Feather name="sunrise" size={22} color={C.gold} />
        </View>
        {board.daily.length ? (
          <ProgressBar
            value={completedDaily}
            max={board.daily.length}
            color={completedDaily === board.daily.length ? C.mint : undefined}
          />
        ) : null}
        <Text style={S.small}>
          {board.dailyResetAt
            ? `Resets in ${when(board.dailyResetAt)}`
            : 'Riot did not return a daily reset time'}
          {board.weeklyRefillAt ? ` · Weeklies refill ${day(board.weeklyRefillAt)}` : ''}
        </Text>
        {board.weekly.length ? (
          <Text style={S.small}>
            {completedWeekly} of {board.weekly.length} weekly missions complete.
          </Text>
        ) : null}
      </View>

      <Tabs
        value={tab}
        onChange={setTab}
        items={tabs.map((item) => ({
          id: item.id,
          label: item.count ? `${item.label} ${item.count}` : item.label,
        }))}
      />

      {tab === 'daily' &&
        (board.daily.length ? (
          board.daily.map((mission) => <MissionCard key={mission.id} mission={mission} />)
        ) : (
          <Empty
            icon="sunrise"
            title="No daily missions returned"
            detail="Riot returns dailies once you have played this season. Pull down to refresh."
          />
        ))}

      {tab === 'weekly' &&
        (board.weekly.length ? (
          board.weekly.map((mission) => <MissionCard key={mission.id} mission={mission} />)
        ) : (
          <Empty
            icon="calendar"
            title="No weekly missions active"
            detail={
              board.weeklyRefillAt
                ? `The next refill is ${day(board.weeklyRefillAt)}.`
                : 'Pull down to refresh.'
            }
          />
        ))}

      {tab === 'queued' && (
        <>
          <Text style={S.small}>
            These weekly missions have unlocked but Riot has not placed them in your active list
            yet. They usually arrive as you finish the current ones.
          </Text>
          {board.queued.length ? (
            board.queued.map((definition) => (
              <DefinitionCard
                key={definition.id}
                definition={definition}
                note={definition.week ? `Week ${definition.week}` : undefined}
              />
            ))
          ) : (
            <Empty
              icon="inbox"
              title="Nothing queued"
              detail="Every unlocked weekly is already in your active list."
            />
          )}
        </>
      )}

      {tab === 'upcoming' && (
        <>
          {board.upcoming.length ? (
            <>
              <WeekSelector
                weeks={board.upcoming}
                value={selected?.group ?? ''}
                onChange={setWeek}
              />
              {selected && (
                <>
                  <SectionHeader
                    title={selected.label}
                    detail={
                      selected.activatesAt ? `Unlocks ${day(selected.activatesAt)}` : undefined
                    }
                  />
                  {selected.missions.map((definition) => (
                    <DefinitionCard key={definition.id} definition={definition} />
                  ))}
                </>
              )}
              <Text style={S.small}>
                This is Riot’s published schedule, not a guarantee that these missions will be
                delivered unchanged.
              </Text>
            </>
          ) : (
            <Empty
              icon="calendar"
              title="No future missions published"
              detail="Riot has not scheduled any later weekly missions yet."
            />
          )}
        </>
      )}

      {!!board.other.length && tab === 'weekly' && (
        <>
          <SectionHeader title="Other missions" />
          {board.other.map((mission) => (
            <MissionCard key={mission.id} mission={mission} />
          ))}
        </>
      )}
    </View>
  );
}

export function MissionsPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { S } = useTheme();
  return (
    <ModalPage>
      <ModalHeader
        eyebrow="SEASON"
        title="Missions"
        closeLabel="Back from missions"
        onClose={onBack}
      />
      <ScrollView contentContainerStyle={[S.content, { paddingBottom: 32 }]}>
        <Resource title="Missions" section={model.snapshot?.progression}>
          {(progression) => <MissionsView progression={progression} catalog={model.catalog} />}
        </Resource>
      </ScrollView>
    </ModalPage>
  );
}
export { renderDirective };
