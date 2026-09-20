import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from './CachedImage';
import { Badge, Button, Empty, ItemArt, ModalHeader, ModalPage, SectionHeader } from './components';
import { Bone, SkeletonGroup } from './Skeleton';
import { useTheme } from './theme';
import type { SpraySlot } from '../core/sprays';
import type { CatalogItem } from '../core/types';
import { safeError } from '../core/validation';
import type { AppModel } from '../state/useApp';

interface Editor {
  slots: SpraySlot[];
  owned: CatalogItem[];
  version?: number;
}

function SlotTile({
  slot,
  selected,
  onPress,
}: {
  slot: SpraySlot;
  selected: boolean;
  onPress(): void;
}) {
  const { C, S } = useTheme();
  return (
    <Pressable
      testID={`spray-slot-${slot.index}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${slot.label} spray, ${slot.item?.name ?? 'empty'}`}
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: 96,
        alignItems: 'center',
        gap: 8,
        paddingVertical: 14,
        paddingHorizontal: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: selected ? C.accent : C.border,
        backgroundColor: selected ? `${C.accent}12` : C.surface,
      }}
    >
      <Text style={[S.small, { fontWeight: '700', color: selected ? C.ink : C.subtle }]}>
        {slot.label.toUpperCase()}
      </Text>
      {slot.item?.image ? (
        <Image
          source={{ uri: slot.item.image }}
          style={{ width: 56, height: 56 }}
          contentFit="contain"
        />
      ) : (
        <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="droplet" size={24} color={C.subtle} />
        </View>
      )}
      <Text style={[S.small, { textAlign: 'center' }]} numberOfLines={2}>
        {slot.item?.name ?? 'Empty'}
      </Text>
    </Pressable>
  );
}

export function SpraysPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { C, S } = useTheme();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [slotIndex, setSlotIndex] = useState(0);
  const [pending, setPending] = useState<Map<number, string | null>>(new Map());
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const stamp = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await model.sprayEditor();
      if (stamp === generation.current) {
        setEditor(data);
        setPending(new Map());
        setSlotIndex((index) => Math.min(index, Math.max(0, data.slots.length - 1)));
      }
    } catch (reason) {
      if (stamp === generation.current) setError(safeError(reason).message);
    } finally {
      if (stamp === generation.current) setLoading(false);
    }
  }, [model.sprayEditor]);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load, model.active?.puuid]);

  const slots = (editor?.slots ?? []).map((slot) =>
    pending.has(slot.index)
      ? {
          ...slot,
          sprayId: pending.get(slot.index)!,
          item: editor?.owned.find((s) => s.canonicalId.toLowerCase() === pending.get(slot.index)),
        }
      : slot,
  );
  const active = slots[slotIndex];
  const usedElsewhere = new Set(
    slots
      .filter((s) => s.index !== slotIndex)
      .map((s) => s.sprayId)
      .filter((id): id is string => !!id),
  );

  const choose = (sprayId: string | null) => {
    if (!editor) return;
    setNotice(null);
    setPending((old) => {
      const next = new Map(old);
      const original = editor.slots[slotIndex]?.sprayId ?? null;
      if (sprayId === original) next.delete(slotIndex);
      else next.set(slotIndex, sprayId);
      return next;
    });
  };

  const save = async () => {
    if (!editor || !pending.size || saving) return;
    const stamp = generation.current;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await model.saveSprays(
        [...pending.entries()].map(([index, sprayId]) => ({ slotIndex: index, sprayId })),
        editor.version,
      );
      if (stamp !== generation.current) return;
      setNotice('Sprays updated and confirmed by Riot.');
      await load();
    } catch (reason) {
      if (stamp === generation.current) setError(safeError(reason).message);
    } finally {
      if (stamp === generation.current) setSaving(false);
    }
  };

  return (
    <ModalPage>
      <ModalHeader
        eyebrow="LOADOUT"
        title="Sprays"
        detail={
          pending.size
            ? `${pending.size} unsaved ${pending.size === 1 ? 'change' : 'changes'}`
            : undefined
        }
        closeLabel="Back from sprays"
        onClose={onBack}
      />
      <ScrollView contentContainerStyle={[S.content, { paddingBottom: 32 }]}>
        {error && (
          <View
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
            <Text testID="spray-error" style={[S.small, { color: C.ink, flex: 1 }]}>
              {error}
            </Text>
          </View>
        )}
        {notice && (
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              alignItems: 'center',
              padding: 12,
              borderRadius: 14,
              backgroundColor: `${C.mint}1A`,
              borderWidth: 1,
              borderColor: `${C.mint}40`,
            }}
          >
            <Feather name="check-circle" size={15} color={C.mint} />
            <Text testID="spray-saved" style={[S.small, { color: C.ink, flex: 1 }]}>
              {notice}
            </Text>
          </View>
        )}

        {loading && !editor ? (
          <SkeletonGroup label="Loading your sprays">
            <Bone height={128} radius={16} />
            <Bone height={220} radius={16} />
          </SkeletonGroup>
        ) : null}

        {editor && (
          <>
            <SectionHeader title="Wheel" detail="Tap a slot, then pick a spray" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {slots.map((slot) => (
                <SlotTile
                  key={slot.slotId}
                  slot={slot}
                  selected={slot.index === slotIndex}
                  onPress={() => setSlotIndex(slot.index)}
                />
              ))}
            </View>

            <SectionHeader
              title={active ? `${active.label} spray` : 'Sprays'}
              detail={`${editor.owned.length} owned`}
            />
            {editor.owned.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <Pressable
                  testID="spray-clear"
                  accessibilityRole="button"
                  accessibilityLabel="Clear this slot"
                  onPress={() => choose(null)}
                  style={{
                    width: 96,
                    height: 112,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: active?.sprayId ? C.border : C.accent,
                    backgroundColor: C.surface,
                  }}
                >
                  <Feather name="slash" size={20} color={C.subtle} />
                  <Text style={S.small}>Empty</Text>
                </Pressable>
                {editor.owned.map((spray) => {
                  const id = spray.canonicalId.toLowerCase(),
                    selected = active?.sprayId === id,
                    taken = usedElsewhere.has(id);
                  return (
                    <Pressable
                      key={id}
                      testID={`spray-option-${id}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: taken }}
                      accessibilityLabel={
                        taken ? `${spray.name}, already in another slot` : spray.name
                      }
                      disabled={taken}
                      onPress={() => choose(id)}
                      style={{
                        width: 96,
                        alignItems: 'center',
                        gap: 6,
                        padding: 8,
                        borderRadius: 14,
                        borderWidth: 1,
                        opacity: taken ? 0.4 : 1,
                        borderColor: selected ? C.accent : C.border,
                        backgroundColor: selected ? `${C.accent}12` : C.surface,
                      }}
                    >
                      <ItemArt item={spray} size={64} />
                      <Text style={[S.small, { textAlign: 'center' }]} numberOfLines={2}>
                        {spray.name}
                      </Text>
                      {taken ? <Badge text="IN USE" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Empty
                icon="droplet"
                title="No sprays in your collection"
                detail="Sprays you own appear here once Riot returns your inventory."
              />
            )}

            <View style={{ gap: 10, paddingTop: 6 }}>
              <Button
                title={
                  saving
                    ? 'Saving…'
                    : `Apply ${pending.size || ''} ${pending.size === 1 ? 'change' : 'changes'}`.trim()
                }
                icon="check"
                disabled={!pending.size || saving}
                onPress={() => void save()}
              />
              {!!pending.size && (
                <Button
                  title="Discard changes"
                  secondary
                  disabled={saving}
                  onPress={() => {
                    setPending(new Map());
                    setNotice(null);
                  }}
                />
              )}
              <Text style={S.small}>
                Changes are sent as one update and confirmed by reading your loadout back. Nothing
                is retried automatically.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </ModalPage>
  );
}
