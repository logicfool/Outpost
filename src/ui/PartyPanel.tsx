import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from './CachedImage';
import { PlayerAvatar } from './PlayerAvatar';
import {
  Badge,
  Button,
  Empty,
  IconButton,
  ModalHeader,
  ModalPage,
  SectionHeader,
} from './components';
import { Bone, SkeletonGroup } from './Skeleton';
import { useTheme } from './theme';
import { queueName } from '../core/normalize';
import type { Party, PartyMember } from '../core/partyTypes';
import { useParty } from '../state/useParty';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';

const relative = (at?: number) => {
  if (!at) return undefined;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function MemberRow({
  member,
  party,
  catalog,
  working,
  onOpen,
  onRemove,
}: {
  member: PartyMember;
  party: Party;
  catalog: AppModel['catalog'];
  working: string | null;
  onOpen(): void;
  onRemove(): void;
}) {
  const { C, S } = useTheme();
  const removing = working === `remove:${member.subject}`;
  return (
    <View
      style={[S.card, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${member.name}`}
        onPress={onOpen}
        disabled={member.hidden}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
      >
        <PlayerAvatar card={member.card} catalog={catalog} size={42} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={[S.row, { gap: 6, alignItems: 'center' }]}>
            <Text style={[S.h3, { flexShrink: 1 }]} numberOfLines={1}>
              {member.name}
            </Text>
            {!!member.tag && <Text style={S.small}>#{member.tag}</Text>}
            {member.owner && <Feather name="star" size={12} color={C.gold} />}
          </View>
          <Text style={S.small} numberOfLines={1}>
            {[
              member.level === null ? 'Level hidden' : `Level ${member.level}`,
              member.tierName,
              member.platform,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {member.queueEligibleRemainingLevels ? (
            <Text style={[S.small, { color: C.gold }]}>
              {member.queueEligibleRemainingLevels} levels to competitive
            </Text>
          ) : null}
        </View>
      </Pressable>
      {member.tierImage ? (
        <Image
          source={{ uri: member.tierImage }}
          style={{ width: 26, height: 26 }}
          contentFit="contain"
        />
      ) : null}
      <Badge text={member.ready ? 'READY' : 'WAITING'} color={member.ready ? C.mint : C.subtle} />
      {party.selfIsLeader && !member.self && !member.owner ? (
        <IconButton
          icon={removing ? 'loader' : 'user-x'}
          label={`Remove ${member.name} from the party`}
          color={C.accent}
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

function QueuePicker({
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
    >
      {queues.map((id) => {
        const selected = party.queueId === id,
          disabled = party.inQueue || !party.selfIsLeader || !!working;
        return (
          <Pressable
            key={id}
            testID={`party-queue-${id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={queueName(id)}
            disabled={disabled || selected}
            onPress={() => onChange(id)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              borderWidth: 1,
              opacity: disabled && !selected ? 0.45 : 1,
              borderColor: selected ? C.accent : C.border,
              backgroundColor: selected ? `${C.accent}1F` : C.surface,
            }}
          >
            <Text style={[S.small, { fontWeight: '700', color: selected ? C.ink : C.subtle }]}>
              {queueName(id)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function InviteRow({
  party,
  working,
  onInvite,
}: {
  party: Party;
  working: string | null;
  onInvite(name: string, tag: string): void;
}) {
  const { C, S } = useTheme();
  const [value, setValue] = useState('');
  const [name, tag] = value.split('#');
  const ready = !!name?.trim() && !!tag?.trim();
  return (
    <View style={{ gap: 8 }}>
      <View style={[S.row, { gap: 8 }]}>
        <TextInput
          testID="party-invite-input"
          value={value}
          onChangeText={setValue}
          placeholder="Name#Tag"
          placeholderTextColor={C.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Riot ID to invite"
          maxLength={24}
          style={{
            flex: 1,
            color: C.ink,
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 11,
          }}
        />
        <Button
          title="Invite"
          icon="user-plus"
          disabled={!ready || !!working}
          onPress={() => {
            onInvite(name!.trim(), tag!.trim());
            setValue('');
          }}
        />
      </View>
      {!party.selfIsLeader && (
        <Text style={S.small}>Only the party leader or a moderator can invite players.</Text>
      )}
    </View>
  );
}

function PartyBody({
  party,
  model,
  ...handlers
}: {
  party: Party;
  model: AppModel;
  working: string | null;
  onNavigate: Navigate;
  setReady(ready: boolean): void;
  changeQueue(id: string): void;
  startQueue(): void;
  stopQueue(): void;
  setAccessibility(value: 'OPEN' | 'CLOSED'): void;
  generateCode(): void;
  disableCode(): void;
  invite(name: string, tag: string): void;
  decline(id: string): void;
  remove(subject: string): void;
}) {
  const { C, S } = useTheme();
  const { working, onNavigate } = handlers;
  const self = party.members.find((m) => m.self);
  const notReady = party.members.filter((m) => !m.ready && !m.owner);
  const open = party.accessibility === 'OPEN';
  return (
    <View style={{ gap: 16 }}>
      <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
        <LinearGradient
          colors={party.inQueue ? ['#7BE0B92E', C.raised] : ['#FF46551F', C.raised]}
          style={{ padding: 18, gap: 16 }}
        >
          <View style={S.between}>
            <View style={[S.row, { gap: 7, alignItems: 'center' }]}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: party.inQueue ? C.mint : C.gold,
                }}
              />
              <Text style={{ color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}>
                {party.inQueue ? 'IN QUEUE' : 'PARTY LOBBY'}
              </Text>
            </View>
            <Text style={S.small}>
              {party.members.length}
              {party.maxSize ? ` / ${party.maxSize}` : ''} players
            </Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={[S.title, { fontSize: 27 }]}>
              {party.queueId ? queueName(party.queueId) : 'No queue selected'}
            </Text>
            <Text style={S.small}>
              {party.inQueue && party.queueEntryAt
                ? `Searching for ${relative(party.queueEntryAt)}`
                : party.selfIsLeader
                  ? 'You are the party leader.'
                  : 'Only the leader can start the queue.'}
            </Text>
          </View>
          <QueuePicker party={party} working={working} onChange={handlers.changeQueue} />
          <View style={[S.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              {party.inQueue ? (
                <Button
                  title="Stop queue"
                  icon="square"
                  disabled={!party.selfIsLeader || !!working}
                  onPress={handlers.stopQueue}
                />
              ) : (
                <Button
                  title="Start queue"
                  icon="play"
                  disabled={!party.selfIsLeader || !party.queueId || !!notReady.length || !!working}
                  onPress={handlers.startQueue}
                />
              )}
            </View>
            {self && (
              <View style={{ flex: 1 }}>
                <Button
                  title={self.ready ? 'Not ready' : 'Ready up'}
                  secondary
                  icon={self.ready ? 'x-circle' : 'check-circle'}
                  disabled={!!working}
                  onPress={() => handlers.setReady(!self.ready)}
                />
              </View>
            )}
          </View>
          {!party.inQueue && !!notReady.length && (
            <Text style={[S.small, { color: C.gold }]}>
              {notReady.map((m) => m.name).join(', ')} {notReady.length === 1 ? 'is' : 'are'} not
              ready.
            </Text>
          )}
        </LinearGradient>
      </View>

      <SectionHeader title="Members" detail={party.members.length === 1 ? 'Just you' : undefined} />
      {party.members.map((member) => (
        <MemberRow
          key={member.subject}
          member={member}
          party={party}
          catalog={model.catalog}
          working={working}
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
          onRemove={() => handlers.remove(member.subject)}
        />
      ))}

      <SectionHeader title="Invitations" />
      <InviteRow party={party} working={working} onInvite={handlers.invite} />
      {party.requests.length ? (
        <>
          <Text style={S.small}>
            {party.requests.length} pending join{' '}
            {party.requests.length === 1 ? 'request' : 'requests'}
          </Text>
          {party.requests.map((request) => (
            <View key={request.id} style={[S.card, S.between, { paddingVertical: 12 }]}>
              <Text style={[S.body, { flex: 1 }]} numberOfLines={1}>
                {request.name
                  ? `${request.name}#${request.tag}`
                  : `Player · ${request.subject.slice(0, 8)}`}
              </Text>
              <Button
                title="Decline"
                secondary
                disabled={!party.selfIsLeader || !!working}
                onPress={() => handlers.decline(request.id)}
              />
            </View>
          ))}
        </>
      ) : null}

      <SectionHeader title="Who can join" />
      <View style={[S.card, { gap: 12 }]}>
        <View style={[S.row, { gap: 8 }]}>
          {(['CLOSED', 'OPEN'] as const).map((value) => {
            const selected = party.accessibility === value;
            return (
              <Pressable
                key={value}
                testID={`party-access-${value.toLowerCase()}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={value === 'OPEN' ? 'Open to friends' : 'Invite only'}
                disabled={!party.selfIsLeader || !!working || selected}
                onPress={() => handlers.setAccessibility(value)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 11,
                  borderRadius: 14,
                  borderWidth: 1,
                  opacity: party.selfIsLeader ? 1 : 0.5,
                  borderColor: selected ? C.accent : C.border,
                  backgroundColor: selected ? `${C.accent}16` : 'transparent',
                }}
              >
                <Text style={[S.small, { fontWeight: '700', color: selected ? C.ink : C.subtle }]}>
                  {value === 'OPEN' ? 'Friends can join' : 'Invite only'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {party.inviteCode ? (
          <View style={[S.between, { gap: 10 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={S.small}>PARTY CODE</Text>
              <Text testID="party-code" style={[S.h2, { letterSpacing: 3 }]}>
                {party.inviteCode.toUpperCase()}
              </Text>
            </View>
            <Button
              title="Disable"
              secondary
              disabled={!party.selfIsLeader || !!working}
              onPress={handlers.disableCode}
            />
          </View>
        ) : (
          <Button
            title="Create party code"
            secondary
            icon="hash"
            disabled={!party.selfIsLeader || !!working}
            onPress={handlers.generateCode}
          />
        )}
        {open && (
          <Text style={S.small}>Your friends can join this party without an invitation.</Text>
        )}
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
  const section = party.section;

  return (
    <ModalPage>
      <ModalHeader
        eyebrow="LOBBY"
        title="Party"
        detail={
          section?.status === 'ready'
            ? `Updated ${relative(section.data.observedAt)} ago`
            : undefined
        }
        closeLabel="Back from party"
        onClose={onBack}
      />
      <ScrollView
        contentContainerStyle={[S.content, { paddingBottom: 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {party.error && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss party error"
            onPress={party.dismissError}
            style={{
              flexDirection: 'row',
              gap: 8,
              alignItems: 'center',
              padding: 12,
              borderRadius: 14,
              backgroundColor: `${C.accent}1A`,
              borderWidth: 1,
              borderColor: `${C.accent}40`,
            }}
          >
            <Feather name="alert-circle" size={15} color={C.accent} />
            <Text testID="party-error" style={[S.small, { color: C.ink, flex: 1 }]}>
              {party.error}
            </Text>
          </Pressable>
        )}

        {!section && party.busy ? (
          <SkeletonGroup label="Loading your party">
            <Bone height={190} radius={20} />
            <Bone height={72} radius={16} />
            <Bone height={72} radius={16} />
          </SkeletonGroup>
        ) : null}

        {section?.status === 'ready' && (
          <PartyBody
            party={section.data}
            model={model}
            working={party.working}
            onNavigate={onNavigate}
            setReady={(ready) => void party.run('ready', (c) => c.setReady(ready))}
            changeQueue={(id) => void party.run(`queue:${id}`, (c) => c.changeQueue(id))}
            startQueue={() => void party.run('start', (c) => c.startQueue())}
            stopQueue={() => void party.run('stop', (c) => c.stopQueue())}
            setAccessibility={(value) =>
              void party.run('access', (c) => c.setPartyAccessibility(value))
            }
            generateCode={() => void party.run('code', (c) => c.generatePartyCode())}
            disableCode={() => void party.run('code', (c) => c.disablePartyCode())}
            invite={(name, tag) => void party.run('invite', (c) => c.invitePlayer(name, tag))}
            decline={(id) => void party.run(`decline:${id}`, (c) => c.declineJoinRequest(id))}
            remove={(subject) =>
              void party.run(`remove:${subject}`, (c) => c.removePartyMember(subject))
            }
          />
        )}

        {section?.status === 'error' && (
          <Empty
            icon={section.code === 'PARTY_ABSENT' ? 'users' : 'alert-circle'}
            title={section.code === 'PARTY_ABSENT' ? 'No party is open' : 'Party unavailable'}
            detail={
              section.code === 'PARTY_ABSENT'
                ? 'Riot creates a party when VALORANT is running on your computer. Open the game, then refresh.'
                : section.message
            }
          />
        )}

        <SectionHeader title="Join with a code" />
        <View style={[S.row, { gap: 8 }]}>
          <TextInput
            testID="party-code-input"
            value={code}
            onChangeText={setCode}
            placeholder="Party code"
            placeholderTextColor={C.subtle}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Party code to join"
            maxLength={16}
            style={{
              flex: 1,
              color: C.ink,
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 11,
              letterSpacing: 2,
            }}
          />
          <Button
            title="Join"
            icon="log-in"
            disabled={code.trim().length < 4 || !!party.working}
            onPress={() => {
              void party.run('join', (c) => c.joinPartyByCode(code.trim()));
              setCode('');
            }}
          />
        </View>

        <View style={{ gap: 8, paddingTop: 4 }}>
          <Button
            title="Refresh party"
            secondary
            icon="refresh-cw"
            disabled={party.busy}
            onPress={party.refresh}
          />
          <Text style={S.small}>
            Party actions are sent to Riot only when you tap them. Outpost never readies up, queues
            or invites on its own.
          </Text>
        </View>
      </ScrollView>
    </ModalPage>
  );
}
