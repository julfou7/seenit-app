import { useMemo } from 'react';
import { PROFILE_MONTH_LABELS, buildProfileYearStats, defaultProfileYear, formatProfileHours, type ProfileViewing } from '../../features/profile/profileYearStats';

const MONTH_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const BAR_HEIGHT = 64;

/** SEENIT-PROFILE-001 : l'année en vitrine de Moi, douze barres avec leur valeur, sans interaction ni animation. */
export function MoiYearCard({ viewings, onStats, onYear }: { viewings: readonly ProfileViewing[]; onStats: () => void; onYear: () => void }) {
  const now = Date.now();
  const year = defaultProfileYear(viewings, now);
  const stats = useMemo(() => buildProfileYearStats(viewings, year, now), [viewings, year]);
  const current = new Date(now);
  const currentMonth = year === current.getFullYear() ? current.getMonth() : -1;
  const max = Math.max(1, ...stats.months);
  const summary = `${PROFILE_MONTH_LABELS.map((label, month) => month < stats.months.length ? `${label} ${Math.round(stats.months[month] / 60)} h` : null).filter(Boolean).join(', ')}`;
  return (
    <section className="moi-year-card" aria-labelledby="moi-year-card-title">
      <span id="moi-year-card-title" className="moi-eyebrow">Ton année {year}</span>
      <div className="moi-year-card-total">
        <div><strong>{formatProfileHours(stats.minutes)}</strong><small>devant l’écran</small></div>
        <p><span>{stats.episodes.toLocaleString('fr-FR')} {stats.episodes > 1 ? 'épisodes' : 'épisode'}</span><span>{stats.films.toLocaleString('fr-FR')} {stats.films > 1 ? 'films' : 'film'}</span></p>
      </div>
      <span className="moi-year-card-label">Heures par mois</span>
      <div className="moi-month-bars" role="img" aria-label={`Heures par mois en ${year} : ${summary}`}>
        {MONTH_SHORT.map((label, month) => {
          const known = month < stats.months.length;
          const minutes = known ? stats.months[month] : 0;
          const hours = Math.round(minutes / 60);
          const record = known && stats.recordMonth === month;
          const state = !known ? 'future' : record ? 'record' : month === currentMonth ? 'current' : minutes <= 0 ? 'empty' : 'past';
          return (
            <span key={label} className="moi-month-bar" data-state={state} aria-hidden="true">
              <b>{known ? hours : '–'}</b>
              <i style={{ height: known ? Math.max(3, Math.round(minutes / max * BAR_HEIGHT)) : 3 }} />
              <small>{label}</small>
            </span>
          );
        })}
      </div>
      <div className="moi-year-card-actions">
        <button type="button" className="moi-primary" onClick={onStats}>Mes chiffres</button>
        <button type="button" className="moi-secondary" onClick={onYear}>Mon année</button>
      </div>
    </section>
  );
}

export function MoiFateRow({ left, nearlyDone, onOpen }: { left: number; nearlyDone: number; onOpen: () => void }) {
  if (left <= 0) return null;
  return (
    <button type="button" className="moi-fate-row" onClick={onOpen}>
      <i aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M10 8v8M14 8v8" /></svg></i>
      <span>
        <strong>{left} {left > 1 ? 'séries laissées en route' : 'série laissée en route'}</strong>
        {nearlyDone > 0 && <small>{nearlyDone} {nearlyDone > 1 ? 'presque finies à reprendre' : 'presque finie à reprendre'}</small>}
      </span>
      <svg className="moi-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  );
}
