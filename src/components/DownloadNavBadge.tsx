import { useEffect, useMemo, useState } from 'react';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { acknowledgeCompletedDownloads, readConsultedDownloads, resolveDownloadNavState, saveConsultedDownloads } from '../features/navigation/downloadNavState';
export function DownloadNavBadge({ active, onLabelChange }: { active: boolean; onLabelChange: (label: string) => void }) {
  const downloads = useLiveDownloadStore(state => state.downloads);
  const error = useLiveDownloadStore(state => state.error);
  const uid = useDownloadConfigStore(state => state.scopeUid);
  const [consulted, setConsulted] = useState(() => ({ uid, keys: readConsultedDownloads(uid) }));
  const keys = useMemo(() => consulted.uid === uid ? consulted.keys : readConsultedDownloads(uid), [consulted, uid]);
  const acknowledged = useMemo(() => active ? acknowledgeCompletedDownloads(downloads) : keys, [active, downloads, keys]);
  const state = resolveDownloadNavState(downloads, acknowledged, Boolean(error));
  useEffect(() => {
    if (!active || acknowledged.join('\n') === keys.join('\n')) return;
    setConsulted({ uid, keys: acknowledged });
    saveConsultedDownloads(uid, acknowledged);
  }, [active, acknowledged, keys, uid]);
  useEffect(() => { onLabelChange(state.label); }, [state.label, onLabelChange]);
  useEffect(() => () => onLabelChange('Télécharger'), [onLabelChange]);
  if (state.kind === 'none') return null;
  return <span className="navigation-download-dot" data-kind={state.kind} data-counted={state.count > 1} aria-hidden="true">
    {state.kind === 'attention' ? '!' : state.count > 1 ? state.count : ''}
  </span>;
}
