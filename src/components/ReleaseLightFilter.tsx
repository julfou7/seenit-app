import React from 'react';
import type { LightFilter } from '../features/downloads/releaseQuality';

export function ReleaseLightFilter({ value, onChange, disabled }: { value: LightFilter; onChange: (value: LightFilter) => void; disabled?: boolean }) {
  return <select aria-label="Filtrer les releases Light" value={value} disabled={disabled} onChange={event => onChange(event.target.value as LightFilter)} className="min-h-11 rounded-xl bg-zinc-900 border border-white/10 px-3 text-xs text-zinc-300"><option value="all">Light et standard</option><option value="light">Mention Light</option><option value="standard">Sans mention Light</option></select>;
}
