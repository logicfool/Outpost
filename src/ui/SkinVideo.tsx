import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ActivityIndicator, Platform, Text, View } from 'react-native';
import { VideoView, useVideoPlayer, type VideoPlayerStatus } from 'expo-video';
import { safeMedia } from '../core/validation';
import { recordRequest } from '../core/diagnostics';
import { Button } from './components';
import { useTheme } from './theme';

export function SkinVideo({
  uri,
  autoplay = true,
  active = true,
  sound = true,
  onSoundChange,
  refresh,
}: {
  uri: string;
  autoplay?: boolean;
  active?: boolean;
  sound?: boolean;
  onSoundChange?(sound: boolean): void;
  refresh?(): Promise<void>;
}) {
  const [retry, setRetry] = useState(0),
    [refreshing, setRefreshing] = useState(false);
  const reload = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh?.();
    } catch {
      recordRequest({
        at: Date.now(),
        service: 'Skin video',
        method: 'RETRY',
        code: 'VIDEO_CATALOG_REFRESH_FAILED',
        durationMs: 0,
      });
    } finally {
      setRetry((v) => v + 1);
      setRefreshing(false);
    }
  };
  return (
    <VideoSession
      key={`${uri}:${retry}`}
      uri={uri}
      autoplay={autoplay}
      active={active}
      sound={sound}
      onSoundChange={onSoundChange}
      retry={() => void reload()}
      refreshing={refreshing}
    />
  );
}
function VideoSession({
  uri,
  autoplay,
  active,
  sound,
  onSoundChange,
  retry,
  refreshing,
}: {
  uri: string;
  autoplay: boolean;
  active: boolean;
  sound: boolean;
  onSoundChange?(sound: boolean): void;
  retry(): void;
  refreshing: boolean;
}) {
  const { C, S } = useTheme();
  const source = useMemo(
    () => ({
      uri: safeMedia(uri),
      useCaching: true,
      contentType: 'progressive' as const,
      ...(Platform.OS !== 'web'
        ? { headers: { 'User-Agent': 'Outpost/0.9.0 (cosmetic preview)' } }
        : {}),
    }),
    [uri],
  );
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = !sound;
    p.volume = 1;
    p.audioMixingMode = 'mixWithOthers';
  });
  const [status, setStatus] = useState<VideoPlayerStatus>(player.status),
    [playing, setPlaying] = useState(player.playing),
    [muted, setMuted] = useState(!sound),
    [slow, setSlow] = useState(false),
    [firstFrame, setFirstFrame] = useState(false);
  const soundCallback = useRef(onSoundChange);
  soundCallback.current = onSoundChange;
  useEffect(() => {
    player.muted = !sound;
  }, [player, sound]);
  const sourceReady = useRef(false);
  const foreground = useRef(AppState.currentState === 'active' || Platform.OS === 'web'),
    allowed = useRef(active),
    intent = useRef(autoplay);
  allowed.current = active;
  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (!alive) return;
      if (intent.current && allowed.current && foreground.current) {
        if (sourceReady.current && player.status === 'readyToPlay') player.play();
      } else player.pause();
    };
    const statusListener = player.addListener('statusChange', (event) => {
      setStatus(event.status);
      if (event.status === 'readyToPlay') sync();
      if (event.status === 'error')
        recordRequest({
          at: Date.now(),
          service: 'Skin video',
          method: 'PLAY',
          code: 'VIDEO_SOURCE_FAILED',
          durationMs: 0,
        });
    });
    const playback = player.addListener('playingChange', (event) => {
      if (
        sourceReady.current &&
        allowed.current &&
        foreground.current &&
        player.status === 'readyToPlay'
      )
        intent.current = event.isPlaying;
      setPlaying(event.isPlaying);
    });
    const soundListener = player.addListener('mutedChange', (event) => {
      setMuted(event.muted);
      soundCallback.current?.(!event.muted);
    });
    let focused = true;
    const app = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active' && focused;
      sync();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            focused = false;
            foreground.current = false;
            sync();
          })
        : undefined;
    const focus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            focused = true;
            foreground.current = AppState.currentState === 'active';
            sync();
          })
        : undefined;
    sourceReady.current = false;
    void player
      .replaceAsync(source.uri ? source : null)
      .then(() => {
        if (alive) {
          sourceReady.current = true;
          sync();
        }
      })
      .catch(() => {
        if (alive) setStatus('error');
      });

    return () => {
      alive = false;
      statusListener.remove();
      playback.remove();
      soundListener.remove();
      app.remove();
      blur?.remove();
      focus?.remove();
    };
  }, [player, source]);
  useEffect(() => {
    intent.current = autoplay;
    if (autoplay && active && foreground.current) {
      if (sourceReady.current && player.status === 'readyToPlay') player.play();
    } else player.pause();
  }, [autoplay, active, player]);
  useEffect(() => {
    setSlow(false);
    if (status === 'readyToPlay' || status === 'error') return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [status]);
  const toggle = () => {
    intent.current = !player.playing;
    if (intent.current && active && foreground.current) {
      if (sourceReady.current && player.status === 'readyToPlay') player.play();
    } else player.pause();
  };
  const failed = status === 'error' || !source.uri;
  return (
    <View style={{ gap: 10 }}>
      <View
        testID={firstFrame ? 'skin-video-frame-ready' : 'skin-video-loading'}
        style={{
          backgroundColor: '#000000',
          borderRadius: 18,
          overflow: 'hidden',
          width: '100%',
          aspectRatio: 16 / 9,
        }}
      >
        <VideoView
          player={player}
          style={{ width: '100%', height: '100%' }}
          onFirstFrameRender={() => setFirstFrame(true)}
          nativeControls
          contentFit="contain"
          surfaceType="textureView"
          allowsPictureInPicture={false}
          fullscreenOptions={{ enable: true }}
        />
        {(status === 'loading' || status === 'idle') && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              inset: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}
      </View>
      {failed || slow ? (
        <View style={S.row}>
          <Text style={[S.small, { flex: 1 }]}>
            {failed ? 'Preview unavailable.' : 'Video is taking longer to load.'}
          </Text>
          <Button
            secondary
            title={refreshing ? 'Retrying...' : 'Retry video'}
            disabled={refreshing}
            onPress={retry}
          />
        </View>
      ) : null}
      {!failed && (
        <View style={S.row}>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              title={playing ? 'Pause video' : 'Play video'}
              icon={playing ? 'pause' : 'play'}
              onPress={toggle}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              title={muted ? 'Unmute' : 'Mute'}
              icon={muted ? 'volume-x' : 'volume-2'}
              onPress={() => {
                player.muted = !player.muted;
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}
