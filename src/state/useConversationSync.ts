import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppModel } from './useApp';

export function useConversationSync(model: AppModel, subject: string) {
  const enabled = model.settings.autoChatHistory !== false;
  const connected = model.chat.status === 'ready';
  const member = model.chat.friends.some((f) => f.subject === subject);
  const connectAttempted = useRef(false);
  useEffect(() => {
    if (['ready', 'connecting', 'authenticating'].includes(model.chat.status)) {
      connectAttempted.current = true;
      return;
    }
    if (enabled && !connectAttempted.current && model.chat.status === 'disconnected') {
      connectAttempted.current = true;
      void model.connectChat();
    }
  }, [enabled, model.chat.status, model.connectChat]);
  useEffect(() => {
    if (!enabled || !connected || !member) return;
    let stopped = false;
    const sync = () => {
      if (
        !stopped &&
        AppState.currentState !== 'background' &&
        AppState.currentState !== 'inactive'
      )
        void model.autoSyncChatHistory(subject).catch(() => {});
    };
    sync();
    const timer = setInterval(sync, 60000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      listener.remove();
    };
  }, [enabled, connected, member, subject, model.autoSyncChatHistory]);
}
