import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from './theme';
import { queueName } from '../core/normalize';
import {
  activeFilterCount,
  EMPTY_FILTER,
  matchFilterOptions,
  type MatchFilter,
  type MatchDetails,
  type MatchFilterKey,
} from '../core/matchFilters';
import type { MatchSummary } from '../core/types';
export {
  applyMatchFilter,
  activeFilterCount,
  EMPTY_FILTER,
  reconcileFilter,
  matchFilterOptions,
  type MatchFilter,
} from '../core/matchFilters';

const LABELS: Record<string, string> = { WIN: 'Wins', LOSS: 'Losses', DRAW: 'Draws' };
const GROUPS: {
  key: MatchFilterKey;
  title: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}[] = [
  { key: 'queue', title: 'Mode', icon: 'target' },
  { key: 'map', title: 'Map', icon: 'map' },
  { key: 'agent', title: 'Agent', icon: 'user' },
  { key: 'result', title: 'Result', icon: 'flag' },
];

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { C, S } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: 13,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? C.accent : C.border,
        backgroundColor: selected ? `${C.accent}18` : C.surface,
      }}
    >
      <Text
        style={[S.small, { fontWeight: '700', color: selected ? C.ink : C.subtle }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MatchFilterBar({
  matches,
  details,
  value,
  onChange,
}: {
  matches: MatchSummary[];
  details: MatchDetails;
  value: MatchFilter;
  onChange(filter: MatchFilter): void;
}) {
  const { C, S } = useTheme();
  const [open, setOpen] = useState(false);
  const options = useMemo(() => matchFilterOptions(matches, details), [matches, details]);
  const count = activeFilterCount(value);
  const groups = GROUPS.filter(
    (group) =>
      options[group.key].length > 1 ||
      (options[group.key].length === 1 && value[group.key] !== 'all'),
  );
  if (!groups.length) return null;

  const label = (key: MatchFilterKey, id: string) =>
    key === 'queue' ? queueName(id) : key === 'result' ? (LABELS[id] ?? id) : id;

  return (
    <View style={{ gap: 10 }}>
      <View style={[S.between, { gap: 10 }]}>
        <Pressable
          testID="match-filter-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={count ? `Filters, ${count} active` : 'Filters'}
          onPress={() => setOpen((v) => !v)}
          style={[
            S.row,
            {
              gap: 8,
              alignItems: 'center',
              paddingHorizontal: 13,
              paddingVertical: 9,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: count ? C.accent : C.border,
              backgroundColor: count ? `${C.accent}14` : C.surface,
            },
          ]}
        >
          <Feather name="sliders" size={14} color={count ? C.accent : C.subtle} />
          <Text style={[S.small, { fontWeight: '700', color: count ? C.ink : C.subtle }]}>
            Filters{count ? ` · ${count}` : ''}
          </Text>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.subtle} />
        </Pressable>
        {count > 0 && (
          <Pressable
            testID="match-filter-clear"
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            onPress={() => onChange(EMPTY_FILTER)}
          >
            <Text style={[S.small, { color: C.accent, fontWeight: '700' }]}>Clear all</Text>
          </Pressable>
        )}
      </View>

      {open && (
        <View style={{ gap: 12 }}>
          {groups.map((group) => (
            <View key={group.key} style={{ gap: 7 }}>
              <View style={[S.row, { gap: 7, alignItems: 'center' }]}>
                <Feather name={group.icon} size={12} color={C.subtle} />
                <Text style={[S.small, { letterSpacing: 1, fontWeight: '700' }]}>
                  {group.title.toUpperCase()}
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingVertical: 1 }}
              >
                <Chip
                  testID={`match-filter-${group.key}-all`}
                  label="All"
                  selected={value[group.key] === 'all'}
                  onPress={() => onChange({ ...value, [group.key]: 'all' })}
                />
                {options[group.key].map((id) => (
                  <Chip
                    key={id}
                    testID={`match-filter-${group.key}-${id}`}
                    label={label(group.key, id)}
                    selected={value[group.key] === id}
                    onPress={() =>
                      onChange({ ...value, [group.key]: value[group.key] === id ? 'all' : id })
                    }
                  />
                ))}
              </ScrollView>
            </View>
          ))}
          <Text style={S.small}>
            Agent and result filters use the matches whose reports have loaded.
          </Text>
        </View>
      )}
    </View>
  );
}
