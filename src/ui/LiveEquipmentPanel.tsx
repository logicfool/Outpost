import React from 'react';
import type { AppModel } from '../state/useApp';
import type { LiveViewState } from '../core/livePresentation';
import type { Navigate } from './explorerTypes';
import { LivePlayerPanel } from './LivePlayerPanel';
/** A match-wide switcher reuses the same per-player detail and shared cosmetics cache. */
export function LiveEquipmentPanel({
  model,
  matchId,
  subject,
  view,
  onBack,
  onNavigate,
}: {
  model: AppModel;
  matchId: string;
  subject?: string;
  view: LiveViewState;
  onBack(): void;
  onNavigate: Navigate;
}) {
  return (
    <LivePlayerPanel
      model={model}
      matchId={matchId}
      subject={subject}
      view={view}
      onBack={onBack}
      onNavigate={onNavigate}
      allowSwitch
    />
  );
}
