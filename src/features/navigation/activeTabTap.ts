export const ACTIVE_TAB_DOUBLE_TAP_MS = 450;

export interface ActiveTabTapState {
  tabId: string;
  at: number;
}

export type ActiveTabTapAction = 'change-tab' | 'active-single' | 'active-double';

export interface ActiveTabTapResolution {
  action: ActiveTabTapAction;
  nextTap: ActiveTabTapState | null;
}

export function resolveActiveTabTap(
  currentTab: string,
  tappedTab: string,
  previousTap: ActiveTabTapState | null,
  now: number,
  thresholdMs = ACTIVE_TAB_DOUBLE_TAP_MS,
): ActiveTabTapResolution {
  if (currentTab !== tappedTab) {
    return { action: 'change-tab', nextTap: null };
  }

  const elapsed = previousTap?.tabId === tappedTab
    ? now - previousTap.at
    : Number.POSITIVE_INFINITY;

  if (elapsed > 0 && elapsed < thresholdMs) {
    return { action: 'active-double', nextTap: null };
  }

  return {
    action: 'active-single',
    nextTap: { tabId: tappedTab, at: now },
  };
}
