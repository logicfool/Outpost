import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from './CachedImage';
import { PlayerAvatar } from './PlayerAvatar';
import { Button, Empty, ModalHeader, ModalPage, ProgressBar, SectionHeader } from './components';
import { Bone, SkeletonGroup } from './Skeleton';
import { useTheme } from './theme';
import { queueName } from '../core/normalize';
import type { Party, PartyMember } from '../core/partyTypes';
import type { Friend } from '../core/chatTypes';
import { demoPartyFriends } from '../core/demo';
import { useParty } from '../state/useParty';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';

type IconName = React.ComponentProps<typeof Feather>['name'];

const digits = { fontVariant: ['tabular-nums'] as 'tabular-nums'[] };

const updatedLabel = (at?: number) => {
  if (!at) return undefined;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 10) return 'Updated just now';
  return seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.floor(seconds / 60)}m ago`;
};

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function StatusPill({ label, color }: { label: string; color: string }) {
  const { S } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: `${color}1F`,
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={[S.small, { fontWeight: '800', fontSize: 10, color, letterSpacing: 0.4 }]}>
        {label}
      </Text>
    </View>
  );
}

function PartyHero({ party }: { party: Party }) {
  const { C } = useTheme();
  const leader = party.members.find((m) => m.owner) ?? party.members[0];
  const art = leader?.card?.wideArt ?? leader?.card?.wallpaper;
  const size = party.maxSize
    ? `${party.members.length} / ${party.maxSize}`
    : `${party.members.length}`;
  return (
    <View
      testID="party-hero"
      style={{ height: 150, borderRadius: 18, overflow: 'hidden', backgroundColor: C.raised }}
    >
      {art ? (
        <Image
          source={{ uri: art }}
          contentFit="cover"
          style={{ position: 'absolute', inset: 0 }}
          transition={0}
        />
      ) : null}
      <LinearGradient
        colors={['#0B101433', '#0B1014E6']}
        style={{ flex: 1, padding: 16, justifyContent: 'space-between' }}
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <StatusPill
            label={party.inQueue ? 'IN QUEUE' : 'LOBBY'}
            color={party.inQueue ? C.mint : '#E2E6EB'}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Feather name="users" size={12} color="#E2E6EB" />
            <Text style={[digits, { color: '#E2E6EB', fontSize: 12, fontWeight: '700' }]}>
              {size}
            </Text>
          </View>
        </View>
        <View style={{ gap: 3 }}>
          <Text
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontSize: 27, fontWeight: '800', letterSpacing: -0.7 }}
          >
            {party.queueId ? queueName(party.queueId) : 'No mode selected'}
          </Text>
          <Text numberOfLines={1} style={{ color: '#E2E6EB', fontSize: 12 }}>
            {party.selfIsLeader
              ? 'You lead this party'
              : `Led by ${leader?.name ?? 'another player'}`}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
}

function SettingRow({
  icon,
  title,
  detail,
  value,
  disabled,
  onChange,
  testID,
  first = false,
}: {
  icon: IconName;
  title: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
  testID?: string;
  first?: boolean;
}) {
  const { C, S } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 0.5,
        borderTopColor: C.border,
      }}
    >
      <Feather name={icon} size={18} color={C.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[S.h3, { fontSize: 14 }]}>{title}</Text>
        <Text style={[S.small, { fontSize: 11 }]}>{detail}</Text>
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: C.raised, true: C.mint }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={C.raised}
        {...({ activeThumbColor: '#FFFFFF' } as object)}
      />
    </View>
  );
}

function QueueCard({
  party,
  working,
  onStart,
  onStop,
  onReady,
}: {
  party: Party;
  working: string | null;
  onStart(): void;
  onStop(): void;
  onReady(ready: boolean): void;
}) {
  const { C, S } = useTheme();
  const now = useNow(party.inQueue);
  const self = party.members.find((m) => m.self);
  const ready = party.members.filter((m) => m.ready).length;
  const waiting = party.members.filter((m) => !m.ready);
  const blocked = !party.selfIsLeader || !party.queueId || waiting.length > 0;
  const hint = !party.selfIsLeader
    ? 'Only the party leader can start the queue.'
    : !party.queueId
      ? 'Choose a game mode to start.'
      : waiting.length
        ? `Waiting for ${waiting.map((m) => (m.self ? 'you' : m.name)).join(', ')} to ready up.`
        : 'Everyone is ready.';
  return (
    <View
      testID="party-queue-card"
      style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}
    >
      <View style={{ padding: 16, gap: 12 }}>
        {party.inQueue ? (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ gap: 2 }}>
              <Text style={[S.small, { fontSize: 10, letterSpacing: 0.7 }]}>SEARCHING</Text>
              <Text
                testID="party-queue-timer"
                style={[digits, { fontSize: 34, lineHeight: 40, fontWeight: '800', color: C.mint }]}
              >
                {party.queueEntryAt ? clock(now - party.queueEntryAt) : '0:00'}
              </Text>
            </View>
            <ActivityIndicator color={C.mint} />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
              }}
            >
              <Text style={[S.small, { fontSize: 10, letterSpacing: 0.7 }]}>READY CHECK</Text>
              <Text style={[digits, S.small, { fontWeight: '700', color: C.ink }]}>
                {ready} of {party.members.length} ready
              </Text>
            </View>
            <ProgressBar
              value={ready}
              max={party.members.length || 1}
              color={waiting.length ? C.gold : C.mint}
            />
          </View>
        )}
        {party.inQueue ? (
          <Button
            title="Stop queue"
            secondary
            icon="square"
            disabled={!party.selfIsLeader || !!working}
            onPress={onStop}
          />
        ) : (
          <Button
            title="Start queue"
            icon="play"
            disabled={blocked || !!working}
            onPress={onStart}
          />
        )}
        {!party.inQueue ? (
          <Text
            testID="party-queue-hint"
            style={[S.small, { color: waiting.length && party.selfIsLeader ? C.gold : C.muted }]}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      {self && !party.inQueue ? (
        <SettingRow
          testID="party-ready"
          icon="check-circle"
          title="I'm ready"
          detail={
            self.ready
              ? 'Turn off to unready yourself.'
              : party.selfIsLeader
                ? 'Ready up before you start the queue.'
                : 'Let the leader know you are set.'
          }
          value={self.ready}
          disabled={!!working}
          onChange={onReady}
        />
      ) : null}
    </View>
  );
}

function QueueChips({
  party,
  working,
  onChange,
}: {
  party: Party;
  working: string | null;
  onChange(queueId: string): void;
}) {
  const { C, S } = useTheme();
  const queues = party.eligibleQueues.length
    ? party.eligibleQueues
    : party.queueId
      ? [party.queueId]
      : [];
  if (!queues.length)
    return <Text style={S.small}>Riot has not listed any queues for this party.</Text>;
  const locked = party.inQueue || !party.selfIsLeader || !!working;
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {queues.map((id) => {
        const selected = party.queueId === id;
        return (
          <Pressable
            key={id}
            testID={`party-queue-${id}`}
            accessibilityRole="radio"
            accessibilityLabel={queueName(id)}
            accessibilityState={{ selected, disabled: locked }}
            disabled={locked || selected}
            onPress={() => onChange(id)}
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 13,
              borderRadius: 999,
              backgroundColor: selected ? `${C.accent}1F` : C.raised,
              opacity: pressed ? 0.7 : locked && !selected ? 0.55 : 1,
            })}
          >
            <Text
              numberOfLines={1}
              style={[
                S.small,
                { fontSize: 13, fontWeight: '700', color: selected ? C.accent : C.muted },
              ]}
            >
              {queueName(id)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Segmented<T extends string>({
  options,
  value,
  disabled,
  onChange,
}: {
  options: { value: T; label: string; testID: string }[];
  value: T;
  disabled: boolean;
  onChange(value: T): void;
}) {
  const { C, S } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', backgroundColor: C.raised, borderRadius: 10, padding: 2 }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled || selected}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 8,
              backgroundColor: selected ? C.surface : 'transparent',
              opacity: pressed ? 0.7 : disabled && !selected ? 0.55 : 1,
            })}
          >
            <Text
              style={[
                S.small,
                { fontSize: 12, fontWeight: '700', color: selected ? C.ink : C.subtle },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  const { C, S } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Text style={[S.small, { fontSize: 11, letterSpacing: 0.7, paddingHorizontal: 4 }]}>
          {label}
        </Text>
      ) : null}
      <View style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

function Row({ first = false, children }: { first?: boolean; children: React.ReactNode }) {
  const { C } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 0.5,
        borderTopColor: C.border,
      }}
    >
      {children}
    </View>
  );
}

function FriendRow({
  friend,
  first,
  catalog,
  state,
  disabled,
  onInvite,
}: {
  friend: Friend;
  first: boolean;
  catalog: AppModel['catalog'];
  state: 'idle' | 'sending' | 'sent';
  disabled: boolean;
  onInvite(): void;
}) {
  const { C, S } = useTheme();
  const away = friend.presence === 'away';
  return (
    <Row first={first}>
      <View>
        <PlayerAvatar card={friend.card} catalog={catalog} size={36} />
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 11,
            height: 11,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: C.surface,
            backgroundColor: away ? C.gold : C.mint,
          }}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[S.h3, { fontSize: 14 }]}>
          {friend.name}
          <Text style={{ fontWeight: '400', color: C.subtle }}> #{friend.tag}</Text>
        </Text>
        <Text numberOfLines={1} style={[S.small, { fontSize: 11 }]}>
          {away ? 'Away' : 'In menus'}
        </Text>
      </View>
      <Pressable
        testID={`party-invite-friend-${friend.subject}`}
        accessibilityRole="button"
        accessibilityLabel={`Invite ${friend.name}`}
        disabled={disabled || state !== 'idle'}
        onPress={onInvite}
        hitSlop={6}
        style={({ pressed }) => ({
          minWidth: 72,
          alignItems: 'center',
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: 999,
          backgroundColor: state === 'sent' ? C.raised : `${C.accent}1F`,
          opacity: pressed ? 0.7 : disabled && state === 'idle' ? 0.5 : 1,
        })}
      >
        {state === 'sending' ? (
          <ActivityIndicator size="small" color={C.accent} />
        ) : (
          <Text
            style={[
              S.small,
              {
                fontSize: 12,
                fontWeight: '700',
                color: state === 'sent' ? C.subtle : C.accent,
              },
            ]}
          >
            {state === 'sent' ? 'Invited' : 'Invite'}
          </Text>
        )}
      </Pressable>
    </Row>
  );
}

function MemberRow({
  member,
  index,
  editing,
  removable,
  removing,
  catalog,
  onOpen,
  onRemove,
}: {
  member: PartyMember;
  index: number;
  editing: boolean;
  removable: boolean;
  removing: boolean;
  catalog: AppModel['catalog'];
  onOpen(): void;
  onRemove(): void;
}) {
  const { C, S } = useTheme();
  const status = member.owner
    ? member.ready
      ? 'Leader'
      : 'Leader · Not ready'
    : member.ready
      ? 'Ready'
      : 'Not ready';
  const statusColor = member.owner ? C.gold : member.ready ? C.mint : C.subtle;
  return (
    <View
      testID={`party-member-${member.subject}`}
      style={{
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: index ? 0.5 : 0,
        borderTopColor: C.border,
        backgroundColor: member.self ? `${C.mint}0A` : C.surface,
      }}
    >
      {editing && removable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${member.name} from the party`}
          onPress={onRemove}
          disabled={removing}
          hitSlop={8}
          style={{ paddingLeft: 12 }}
        >
          {removing ? (
            <ActivityIndicator color={C.accent} />
          ) : (
            <Feather name="minus-circle" size={22} color={C.accent} />
          )}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${member.name}`}
        disabled={member.hidden}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 11,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <PlayerAvatar card={member.card} catalog={catalog} size={42} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text
            numberOfLines={1}
            style={[S.h3, { fontSize: 14, color: member.self ? C.mint : C.ink }]}
          >
            {member.self ? 'You' : member.name}
            {!member.self && member.tag ? (
              <Text style={{ fontWeight: '400', color: C.subtle }}> #{member.tag}</Text>
            ) : null}
          </Text>
          <Text numberOfLines={1} style={[S.small, { fontSize: 11 }]}>
            <Text
              testID={`party-member-status-${member.subject}`}
              style={{ color: statusColor, fontWeight: '700' }}
            >
              {status}
            </Text>
            {member.level === null ? '' : ` · Lv ${member.level}`}
            {member.queueEligibleRemainingLevels
              ? ` · ${member.queueEligibleRemainingLevels} levels to competitive`
              : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'center', gap: 3, maxWidth: 96 }}>
          {member.tierImage ? (
            <Image
              source={{ uri: member.tierImage }}
              style={{ width: 26, height: 26 }}
              contentFit="contain"
              transition={0}
            />
          ) : (
            <Feather name="award" size={20} color={C.subtle} />
          )}
          <Text numberOfLines={1} style={[S.small, { fontSize: 9, letterSpacing: 0.3 }]}>
            {member.tierName?.toUpperCase() ?? 'UNRATED'}
          </Text>
        </View>
        {!editing && !member.hidden ? (
          <Feather name="chevron-right" size={18} color={C.subtle} />
        ) : null}
      </Pressable>
    </View>
  );
}

function Field({
  testID,
  icon,
  value,
  onChange,
  placeholder,
  label,
  actionLabel,
  actionIcon,
  canSubmit,
  onSubmit,
  code = false,
}: {
  testID: string;
  icon: IconName;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  label: string;
  actionLabel: string;
  actionIcon: IconName;
  canSubmit: boolean;
  onSubmit(): void;
  code?: boolean;
}) {
  const { C } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: C.surface,
        borderRadius: 14,
        paddingLeft: 14,
        paddingRight: 6,
        minHeight: 52,
      }}
    >
      <Feather name={icon} size={16} color={C.subtle} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.subtle}
        autoCapitalize={code ? 'characters' : 'none'}
        autoCorrect={false}
        accessibilityLabel={label}
        maxLength={code ? 16 : 24}
        returnKeyType="send"
        onSubmitEditing={() => canSubmit && onSubmit()}
        style={{
          flex: 1,
          color: C.ink,
          fontSize: 15,
          paddingVertical: 12,
          letterSpacing: code ? 1.5 : 0,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: canSubmit ? C.accent : C.raised,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Feather name={actionIcon} size={17} color={canSubmit ? '#FFFFFF' : C.subtle} />
      </Pressable>
    </View>
  );
}

type PartyHandlers = {
  setReady(ready: boolean): void;
  changeQueue(id: string): void;
  startQueue(): void;
  stopQueue(): void;
  setAccessibility(value: 'OPEN' | 'CLOSED'): void;
  generateCode(): void;
  disableCode(): void;
  invite(name: string, tag: string, key?: string): Promise<boolean>;
  decline(id: string): void;
  remove(subject: string): void;
};

export function invitableFriends(friends: readonly Friend[], party: Party): Friend[] {
  const members = new Set(party.members.map((m) => m.subject));
  return friends
    .filter(
      (f) =>
        !members.has(f.subject) &&
        !f.hidden &&
        !!f.name &&
        !!f.tag &&
        f.presenceSource === 'valorant' &&
        (f.presence === 'online' || f.presence === 'away') &&
        (f.partySize ?? 1) <= 1,
    )
    .sort(
      (a, b) =>
        Number(a.presence === 'away') - Number(b.presence === 'away') ||
        a.name.localeCompare(b.name),
    );
}

function PartyBody({
  party,
  model,
  friends,
  working,
  onNavigate,
  handlers,
  joinField,
}: {
  party: Party;
  model: AppModel;
  friends: Friend[];
  working: string | null;
  onNavigate: Navigate;
  handlers: PartyHandlers;
  joinField: React.ReactNode;
}) {
  const { C, S } = useTheme();
  const [editing, setEditing] = useState(false);
  const [riotId, setRiotId] = useState('');
  const [invited, setInvited] = useState<Record<string, true>>({});
  const self = party.members.find((m) => m.self);
  const canManage = party.selfIsLeader || !!self?.moderator;
  const canEdit = party.selfIsLeader && party.members.some((m) => !m.self && !m.owner);
  const [name, tag] = riotId.split('#');
  const canInvite = !!name?.trim() && !!tag?.trim() && !working && canManage;
  const full = !!party.maxSize && party.members.length >= party.maxSize;
  const actionStyle = [S.small, { color: C.accent, fontWeight: '700' as const, fontSize: 13 }];
  const online = invitableFriends(friends, party);

  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  return (
    <View style={{ gap: 14 }}>
      <PartyHero party={party} />
      <QueueCard
        party={party}
        working={working}
        onStart={handlers.startQueue}
        onStop={handlers.stopQueue}
        onReady={handlers.setReady}
      />

      <SectionHeader
        title="Members"
        detail={`${party.members.length}${party.maxSize ? ` of ${party.maxSize}` : ''}`}
        action={
          canEdit ? (
            <Pressable
              testID="party-edit-members"
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Done editing members' : 'Edit members'}
              onPress={() => setEditing((value) => !value)}
              hitSlop={8}
            >
              <Text style={actionStyle}>{editing ? 'Done' : 'Edit'}</Text>
            </Pressable>
          ) : undefined
        }
      />
      <View style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}>
        {party.members.map((member, index) => (
          <MemberRow
            key={member.subject}
            member={member}
            index={index}
            editing={editing}
            removable={party.selfIsLeader && !member.self && !member.owner}
            removing={working === `remove:${member.subject}`}
            catalog={model.catalog}
            onRemove={() => handlers.remove(member.subject)}
            onOpen={() =>
              onNavigate({
                type: 'player',
                player: {
                  subject: member.subject,
                  name: member.name,
                  tag: member.tag,
                  card: member.card,
                  title: member.title,
                  level: member.level,
                  hidden: member.hidden,
                },
              })
            }
          />
        ))}
        {party.requests.map((request) => (
          <Row key={request.id}>
            <Feather name="log-in" size={16} color={C.muted} />
            <Text style={[S.h3, { flex: 1, fontSize: 14 }]} numberOfLines={1}>
              {request.name ? `${request.name}#${request.tag}` : 'A player'} wants to join
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decline join request"
              disabled={!party.selfIsLeader || !!working}
              onPress={() => handlers.decline(request.id)}
              hitSlop={8}
            >
              <Text style={actionStyle}>Decline</Text>
            </Pressable>
          </Row>
        ))}
      </View>

      <SectionHeader
        title="Party settings"
        detail={party.selfIsLeader ? undefined : 'Leader only'}
      />
      <Group>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Feather name="crosshair" size={18} color={C.muted} />
            <Text style={[S.h3, { flex: 1, fontSize: 14 }]}>Queue type</Text>
          </View>
          <QueueChips party={party} working={working} onChange={handlers.changeQueue} />
        </View>
        <Row>
          <Feather
            name={party.accessibility === 'OPEN' ? 'unlock' : 'lock'}
            size={18}
            color={C.muted}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[S.h3, { fontSize: 14 }]}>Party type</Text>
            <Text style={[S.small, { fontSize: 11 }]}>
              {party.accessibility === 'OPEN' ? 'Friends can join freely' : 'Invite or code only'}
            </Text>
          </View>
          <Segmented
            value={party.accessibility === 'OPEN' ? 'OPEN' : 'CLOSED'}
            disabled={!party.selfIsLeader || !!working}
            onChange={handlers.setAccessibility}
            options={[
              { value: 'OPEN', label: 'Open', testID: 'party-access-open' },
              { value: 'CLOSED', label: 'Closed', testID: 'party-access-closed' },
            ]}
          />
        </Row>
      </Group>

      <SectionHeader title="Invite" detail={full ? 'Party is full' : undefined} />
      <Group label="ONLINE FRIENDS">
        {online.length ? (
          online.map((friend, index) => (
            <FriendRow
              key={friend.subject}
              friend={friend}
              first={index === 0}
              catalog={model.catalog}
              disabled={!canManage || full || !!working}
              state={
                working === `invite:${friend.subject}`
                  ? 'sending'
                  : invited[friend.subject]
                    ? 'sent'
                    : 'idle'
              }
              onInvite={() =>
                void handlers
                  .invite(friend.name, friend.tag, `invite:${friend.subject}`)
                  .then((ok) => {
                    if (ok) setInvited((value) => ({ ...value, [friend.subject]: true }));
                  })
              }
            />
          ))
        ) : (
          <Row first>
            <Feather name="moon" size={16} color={C.subtle} />
            <Text testID="party-friends-empty" style={[S.small, { flex: 1 }]}>
              {model.chat.status === 'ready'
                ? 'No friends are free to invite right now.'
                : 'Connect chat on the Friends tab to see who is online.'}
            </Text>
          </Row>
        )}
      </Group>

      <Group label="PARTY CODE">
        <Row first>
          <Feather name="hash" size={18} color={C.muted} />
          <View style={{ flex: 1, gap: 2 }}>
            {party.inviteCode ? (
              <Text
                testID="party-code"
                selectable
                style={[digits, S.h3, { fontSize: 18, letterSpacing: 3, color: C.ink }]}
              >
                {party.inviteCode.toUpperCase()}
              </Text>
            ) : (
              <Text style={[S.h3, { fontSize: 14 }]}>No code yet</Text>
            )}
            <Text style={[S.small, { fontSize: 11 }]}>
              {party.inviteCode ? 'Share it so friends can join.' : 'Generate one to share.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={party.inviteCode ? 'Disable party code' : 'Generate party code'}
            disabled={!party.selfIsLeader || !!working}
            onPress={party.inviteCode ? handlers.disableCode : handlers.generateCode}
            hitSlop={6}
            style={({ pressed }) => ({
              paddingVertical: 7,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: party.inviteCode ? C.raised : `${C.accent}1F`,
              opacity: pressed ? 0.7 : !party.selfIsLeader || working ? 0.5 : 1,
            })}
          >
            {working === 'code' ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <Text
                style={[
                  S.small,
                  {
                    fontSize: 12,
                    fontWeight: '700',
                    color: party.inviteCode ? C.muted : C.accent,
                  },
                ]}
              >
                {party.inviteCode ? 'Disable' : 'Generate'}
              </Text>
            )}
          </Pressable>
        </Row>
      </Group>

      <View style={{ gap: 8 }}>
        <Text style={[S.small, { fontSize: 11, letterSpacing: 0.7, paddingHorizontal: 4 }]}>
          JOIN WITH CODE
        </Text>
        {joinField}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={[S.small, { fontSize: 11, letterSpacing: 0.7, paddingHorizontal: 4 }]}>
          INVITE BY RIOT ID
        </Text>
        <Field
          testID="party-invite-input"
          icon="user-plus"
          value={riotId}
          onChange={setRiotId}
          placeholder="Name#TAG"
          label="Riot ID to invite"
          actionLabel="Send invite"
          actionIcon="send"
          canSubmit={canInvite && !full}
          onSubmit={() => {
            void handlers.invite(name!.trim(), tag!.trim());
            setRiotId('');
          }}
        />
        {!canManage ? (
          <Text style={[S.small, { paddingHorizontal: 4 }]}>
            Only the party leader or a moderator can invite players.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function PartyPanel({
  model,
  onBack,
  onNavigate,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const party = useParty(model, true);
  const [code, setCode] = useState('');
  const friends = useMemo(
    () => (model.active?.demo ? demoPartyFriends(Date.now()) : model.chat.friends),
    [model.active?.demo, model.chat.friends],
  );
  const section = party.section;
  const detail =
    section?.status === 'ready'
      ? [
          `${section.data.members.length}${section.data.maxSize ? ` of ${section.data.maxSize}` : ''} players`,
          updatedLabel(section.data.observedAt),
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  const joinField = (
    <Field
      testID="party-code-input"
      icon="hash"
      value={code}
      onChange={setCode}
      placeholder="Party code"
      label="Party code to join"
      actionLabel="Join party"
      actionIcon="arrow-right"
      code
      canSubmit={code.trim().length >= 4 && !party.working}
      onSubmit={() => {
        void party.run('join', (c) => c.joinPartyByCode(code.trim()));
        setCode('');
      }}
    />
  );

  return (
    <ModalPage>
      <ModalHeader title="Party" detail={detail} closeLabel="Back from party" onClose={onBack} />
      <ScrollView
        contentContainerStyle={[S.content, { paddingBottom: 32 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={party.busy && !!section}
            onRefresh={party.refresh}
            tintColor={C.accent}
          />
        }
      >
        {party.error && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss party error"
            onPress={party.dismissError}
            style={{
              flexDirection: 'row',
              gap: 10,
              alignItems: 'center',
              padding: 12,
              borderRadius: 14,
              backgroundColor: C.surface,
            }}
          >
            <Feather name="alert-circle" size={16} color={C.accent} />
            <Text testID="party-error" style={[S.small, { color: C.ink, flex: 1 }]}>
              {party.error}
            </Text>
            <Feather name="x" size={14} color={C.subtle} />
          </Pressable>
        )}

        {!section && party.busy ? (
          <SkeletonGroup label="Loading your party">
            <Bone height={150} radius={18} />
            <Bone height={150} radius={16} />
            <Bone height={216} radius={16} />
          </SkeletonGroup>
        ) : null}

        {section?.status === 'ready' && (
          <PartyBody
            party={section.data}
            model={model}
            friends={friends}
            joinField={joinField}
            working={party.working}
            onNavigate={onNavigate}
            handlers={{
              setReady: (ready) => void party.run('ready', (c) => c.setReady(ready)),
              changeQueue: (id) => void party.run(`queue:${id}`, (c) => c.changeQueue(id)),
              startQueue: () => void party.run('start', (c) => c.startQueue()),
              stopQueue: () => void party.run('stop', (c) => c.stopQueue()),
              setAccessibility: (value) =>
                void party.run('access', (c) => c.setPartyAccessibility(value)),
              generateCode: () => void party.run('code', (c) => c.generatePartyCode()),
              disableCode: () => void party.run('code', (c) => c.disablePartyCode()),
              invite: (name, tag, key = 'invite') =>
                party.run(key, (c) => c.invitePlayer(name, tag)),
              decline: (id) => void party.run(`decline:${id}`, (c) => c.declineJoinRequest(id)),
              remove: (subject) =>
                void party.run(`remove:${subject}`, (c) => c.removePartyMember(subject)),
            }}
          />
        )}

        {section?.status === 'error' && (
          <Empty
            icon={section.code === 'PARTY_ABSENT' ? 'users' : 'alert-circle'}
            title={section.code === 'PARTY_ABSENT' ? 'No party is open' : 'Party unavailable'}
            detail={
              section.code === 'PARTY_ABSENT'
                ? 'Riot creates a party when VALORANT is running on your computer. Open the game, then pull down to refresh.'
                : section.message
            }
          />
        )}

        {section?.status === 'ready' ? null : (
          <>
            <SectionHeader title="Join a party" />
            {joinField}
          </>
        )}

        <Text style={[S.small, { paddingHorizontal: 4, paddingTop: 4 }]}>
          Party actions are sent to Riot only when you tap them. Outpost never readies up, queues or
          invites on its own.
        </Text>
      </ScrollView>
    </ModalPage>
  );
}
