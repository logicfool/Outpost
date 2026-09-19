import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { AppModel } from './useApp';

export function useConversationSync(model: AppModel, subject: string) {
  const enabled = model.settings.autoChatHistory !== false,
    connected = model.chat.status === 'ready';
  const member = model.chat.friends.some((f) => f.subject === subject);
  useEffect(() => {
    if (!enabled || !connected || !member) return;
    let stopped = false;
    const sync = () => {
      if (!stopped && AppState.currentState === 'active')
        void model.autoSyncChatHistory(subject).catch(() => {});
    };
    sync();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      stopped = true;
      listener.remove();
    };
  }, [enabled, connected, member, subject, model.autoSyncChatHistory]);
}
