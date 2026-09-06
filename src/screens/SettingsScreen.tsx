import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SettingsScreen as SettingsScreenCore } from './SettingsScreenCore';
import { DownloadFeatureSettingsCard } from '../components/DownloadFeatureSettingsCard';

export function SettingsScreen() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const sections = rootRef.current?.querySelector('.max-w-md .space-y-3');
    if (!(sections instanceof HTMLElement)) return;

    const host = document.createElement('div');
    host.dataset.seenitDownloadVisibilitySetting = 'true';

    const firstSection = sections.children.item(0);
    if (firstSection) firstSection.after(host);
    else sections.append(host);

    setPortalHost(host);
    return () => {
      setPortalHost(null);
      host.remove();
    };
  }, []);

  return (
    <div ref={rootRef} className="contents">
      <SettingsScreenCore />
      {portalHost ? createPortal(<DownloadFeatureSettingsCard />, portalHost) : null}
    </div>
  );
}
