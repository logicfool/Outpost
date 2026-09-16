import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { safeMedia } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';

export function SkinVideo({
  uri,
  autoplay = true,
  active = true,
  refresh,
}: {
  uri: string;
  autoplay?: boolean;
  active?: boolean;
  refresh?(): Promise<void>;
}) {
  const { S } = useTheme(),
    src = safeMedia(uri),
    video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(true),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [slow, setSlow] = useState(false);
  const wanted = useRef(autoplay),
    current = useRef({ active, src }),
    mounted = useRef(true),
    epoch = useRef(0);
  current.current = { active, src };
  const play = useCallback(async () => {
    const element = video.current,
      generation = epoch.current;
    if (
      !element ||
      !wanted.current ||
      !current.current.active ||
      document.visibilityState === 'hidden' ||
      element.readyState < 2
    )
      return;
    try {
      await element.play();
    } catch (error) {
      if (
        mounted.current &&
        generation === epoch.current &&
        error instanceof DOMException &&
        error.name !== 'AbortError'
      )
        setFailed(true);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const visibility = () => {
      if (document.visibilityState === 'hidden') video.current?.pause();
      else void play();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      epoch.current++;
      document.removeEventListener('visibilitychange', visibility);
      video.current?.pause();
    };
  }, [play]);
  useEffect(() => {
    epoch.current++;
    wanted.current = autoplay;
    setReady(false);
    setFailed(false);
    setSlow(false);
  }, [src]);
  useEffect(() => {
    wanted.current = autoplay;
    if (autoplay && active) void play();
    else video.current?.pause();
  }, [autoplay, active, play]);
  useEffect(() => {
    if (ready || failed) return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [src, ready, failed]);
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    wanted.current = el.paused;
    if (wanted.current) void play();
    else el.pause();
  };
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setSlow(false);
    try {
      await refresh?.();
    } catch {
    } finally {
      if (mounted.current) {
        video.current?.load();
        void play();
        setBusy(false);
      }
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <View
        testID={ready ? 'skin-video-frame-ready' : 'skin-video-loading'}
        style={{
          width: '100%',
          aspectRatio: 16 / 9,
          backgroundColor: '#000000',
          borderRadius: 18,
          overflow: 'hidden',
        }}
      >
        <video
          ref={video}
          src={src}
          muted={muted}
          loop
          playsInline
          controls
          preload="auto"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onLoadedData={() => {
            setReady(true);
            void play();
          }}
          onCanPlay={() => void play()}
          onError={() => setFailed(true)}
          onPlaying={() => {
            setPlaying(true);
            wanted.current = true;
          }}
          onPause={() => {
            setPlaying(false);
            if (
              document.visibilityState !== 'hidden' &&
              current.current.active &&
              video.current?.readyState &&
              video.current.readyState >= 2
            )
              wanted.current = false;
          }}
          onVolumeChange={() => setMuted(video.current?.muted ?? true)}
        />
        {!ready && !failed && (
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
            title={busy ? 'Retrying...' : 'Retry video'}
            disabled={busy}
            onPress={() => void retry()}
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
                if (video.current) video.current.muted = !video.current.muted;
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}
