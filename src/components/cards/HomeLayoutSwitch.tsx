interface Props { label: string; list: boolean; onChange: (list: boolean) => void }

export function HomeLayoutSwitch({ label, list, onChange }: Props) {
  return <div className="home-layout-switch" role="group" aria-label={`Présentation ${label}`}>
    <button type="button" aria-label={`${label} en carrousel`} aria-pressed={!list} onClick={() => onChange(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="7" height="14" rx="2" /><rect x="11" y="5" width="7" height="14" rx="2" /><rect x="20" y="5" width="3" height="14" rx="1.5" opacity=".55" /></svg></button>
    <button type="button" aria-label={`${label} en liste`} aria-pressed={list} onClick={() => onChange(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="2" /><rect x="3" y="10" width="18" height="4" rx="2" /><rect x="3" y="16" width="18" height="4" rx="2" /></svg></button>
  </div>;
}
