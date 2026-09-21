import React, { Activity, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { LivePollingContext } from '../state/useLivePolling';
/** Lazy, retained scenes. Hidden Activity boundaries preserve inputs/scroll but tear down effects.
 * No tab is pre-mounted or allowed to poll until the user visits it. The account is the parent key. */
export function RetainedTabs<T extends string>({
  active,
  interactive,
  render,
}: {
  active: T;
  interactive: boolean;
  render(tab: T, visible: boolean): ReactNode;
}) {
  const [visited, setVisited] = useState<T[]>([active]);
  const scenes = visited.includes(active) ? visited : [...visited, active];
  if (scenes !== visited) setVisited(scenes);
  return (
    <View testID="retained-tab-scenes" style={{ flex: 1 }}>
      {scenes.map((tab) => {
        const visible = tab === active;
        return (
          <Activity key={tab} mode={visible ? 'visible' : 'hidden'}>
            <View testID={`tab-scene-${tab}`} style={{ flex: 1 }}>
              <LivePollingContext.Provider value={visible && interactive}>
                {render(tab, visible)}
              </LivePollingContext.Provider>
            </View>
          </Activity>
        );
      })}
    </View>
  );
}
