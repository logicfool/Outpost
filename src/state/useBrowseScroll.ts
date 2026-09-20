import { useEffect, useRef } from 'react';
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';

export function useBrowseScroll<T>(view: { offset: number }, ready = true) {
  const list = useRef<FlatList<T>>(null),
    initial = useRef({ x: 0, y: view.offset });
  const restoring = useRef(view.offset > 0),
    frame = useRef<number | undefined>(undefined),
    size = useRef({ viewport: 0, content: 0 });
  const restore = () => {
    if (!ready || !restoring.current || !size.current.viewport || !size.current.content) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const offset = Math.min(
        initial.current.y,
        Math.max(0, size.current.content - size.current.viewport),
      );
      list.current?.scrollToOffset({ offset, animated: false });
      view.offset = offset;
      restoring.current = false;
    });
  };
  useEffect(() => {
    restore();
  }, [ready]);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const reset = () => {
    restoring.current = false;
    view.offset = 0;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  return {
    reset,
    props: {
      ref: list,
      contentOffset: initial.current,
      scrollEventThrottle: 100,
      onLayout: (event: LayoutChangeEvent) => {
        size.current.viewport = event.nativeEvent.layout.height;
        restore();
      },
      onContentSizeChange: (_width: number, height: number) => {
        size.current.content = height;
        restore();
      },
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!restoring.current) view.offset = Math.max(0, event.nativeEvent.contentOffset.y);
      },
    },
  };
}
