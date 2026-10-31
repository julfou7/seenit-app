import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { DialogLayer } from '../ui/DialogLayer';

export type SettingsTone = 'ok' | 'warn' | 'error' | 'busy';

const EDGE_SWIPE_START = 70;
const EDGE_SWIPE_DISTANCE = 90;

export function SettingsHeader({ title, onBack, backLabel = 'Retour' }: { title: string; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="reg-head">
      {onBack && (
        <button type="button" className="reg-back" aria-label={backLabel} onClick={onBack} data-dialog-initial-focus>
          <ChevronLeft size={21} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}
      <h2>{title}</h2>
    </div>
  );
}

/** Un écran par sujet : un niveau de la pile Retour, refermable par le bouton, Retour ou le bord gauche. */
export function SettingsSubscreen({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <DialogLayer
      label={title}
      onDismiss={onClose}
      historyMode="local"
      role="dialog"
      blocking={false}
      data-settings-layer=""
      className="reg-root fixed inset-0 z-[60] max-w-md mx-auto flex flex-col"
      onTouchStart={event => {
        event.stopPropagation();
        const touch = event.touches[0];
        start.current = touch.clientX <= EDGE_SWIPE_START ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchMove={event => event.stopPropagation()}
      onTouchEnd={event => {
        event.stopPropagation();
        const origin = start.current;
        start.current = null;
        const touch = event.changedTouches[0];
        if (!origin || !touch) return;
        const dx = touch.clientX - origin.x;
        if (dx > EDGE_SWIPE_DISTANCE && Math.abs(touch.clientY - origin.y) < dx) onClose();
      }}
    >
      <div className="flex-1 overflow-y-auto pb-nav custom-scrollbar">
        <div className="reg-page">
          <SettingsHeader title={title} onBack={onClose} />
          {children}
        </div>
      </div>
    </DialogLayer>
  );
}

export function SettingsGroup({ title, foot, children }: { title?: string; foot?: string; children: ReactNode }) {
  return (
    <section className="reg-group" aria-label={title}>
      {title && <h3 className="reg-group-title">{title}</h3>}
      <div className="reg-group-body">{children}</div>
      {foot && <p className="reg-group-foot">{foot}</p>}
    </section>
  );
}

export interface SettingsRowProps {
  icon?: LucideIcon;
  label: string;
  sub?: ReactNode;
  tone?: SettingsTone;
  dot?: boolean;
  badge?: string;
  toggle?: boolean;
  chevron?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}

export function SettingsRow({ icon: Icon, label, sub, tone, dot, badge, toggle, chevron, danger, busy, disabled, expanded, onClick }: SettingsRowProps) {
  const isToggle = toggle !== undefined;
  const showChevron = chevron ?? (!isToggle && Boolean(onClick));
  const content = (
    <>
      {Icon && <span className="reg-row-icon" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>}
      <span className="reg-row-text">
        <span className="reg-row-label">{label}</span>
        {sub && (
          <span className="reg-row-sub" data-tone={tone}>
            {dot && <span className="reg-dot" data-tone={tone} aria-hidden="true" />}
            {sub}
          </span>
        )}
      </span>
      {badge && <span className="reg-badge">{badge}</span>}
      {busy && <span className="reg-spin" aria-hidden="true" />}
      {isToggle && <span className="reg-switch" data-on={toggle} aria-hidden="true"><span /></span>}
      {showChevron && <ChevronRight size={18} strokeWidth={2.4} className="reg-chev" aria-hidden="true" />}
    </>
  );
  // Une ligne d'état sans action reste lisible, jamais grisée comme un bouton désactivé.
  if (!onClick) return <div className="reg-row" data-danger={danger || undefined} aria-busy={busy || undefined}>{content}</div>;
  return (
    <button
      type="button"
      className="reg-row"
      data-danger={danger || undefined}
      role={isToggle ? 'switch' : undefined}
      aria-checked={isToggle ? toggle : undefined}
      aria-expanded={expanded}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function SettingsCard({ tile, tone, title, sub, status, statusTone, spinning, children }: {
  tile: ReactNode;
  tone?: 'ok' | 'gold' | 'error';
  title: string;
  sub?: ReactNode;
  status?: string;
  statusTone?: SettingsTone;
  spinning?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="reg-card" data-tone={tone}>
      <div className="reg-card-top">
        <span className="reg-tile" data-tone={tone === 'error' ? undefined : tone} aria-hidden="true">{tile}</span>
        <span className="reg-card-text">
          <strong>{title}</strong>
          {sub && <small>{sub}</small>}
        </span>
        {spinning && <span className="reg-spin" aria-hidden="true" />}
      </div>
      {status && (
        <span className="reg-state" data-tone={statusTone} role="status">
          <span className="reg-dot" data-tone={statusTone} aria-hidden="true" />
          {status}
        </span>
      )}
      {children}
    </div>
  );
}

export function SettingsConfirm({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogLayer label={title} onDismiss={onCancel} historyMode="local" role="alertdialog" className="reg-confirm-layer" onClick={onCancel}>
      <div className="reg-confirm" onClick={event => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="reg-confirm-actions">
          <button type="button" className="reg-confirm-cancel" onClick={onCancel} data-dialog-initial-focus>Annuler</button>
          <button type="button" className="reg-confirm-ok" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </DialogLayer>
  );
}

/** « il y a 5 min », « il y a 3 h », « il y a 2 j » ; null si l'horodatage est inconnu. */
export function formatSettingsAgo(timestamp: number | null | undefined, now = Date.now()): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}
