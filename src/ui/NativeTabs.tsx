import React from 'react';
import type { ReactNode } from 'react';
import type { ScreenName } from './screens';

export function nativeTabsAvailable() {
  return false;
}

export function NativeTabs(_props: {
  active: ScreenName;
  interactive: boolean;
  onChange(tab: ScreenName): void;
  render(tab: ScreenName, visible: boolean): ReactNode;
}) {
  return null;
}
