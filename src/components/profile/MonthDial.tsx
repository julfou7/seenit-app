import { useState, type CSSProperties } from 'react';
import { PROFILE_MONTH_LABELS } from '../../features/profile/profileYearStats';
import { useCountUp } from './useReveal';
import { MONTH_DIAL } from './monthDialGeometry';

const MONTH_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const { center: CENTER, inner: INNER, labelRadius: LABEL_RADIUS, maxGrowth: MAX_GROWTH, pop: POP } = MONTH_DIAL;

const point = (radius: number, degrees: number) => {
  const angle = degrees * Math.PI / 180;
  return [CENTER + radius * Math.sin(angle), CENTER - radius * Math.cos(angle)];
};

function sectorPath(month: number, outer: number) {
  const from = month * 30 + 3, to = month * 30 + 27;
  const [x1, y1] = point(INNER, from), [x2, y2] = point(outer, from), [x3, y3] = point(outer, to), [x4, y4] = point(INNER, to);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} A${outer.toFixed(1)} ${outer.toFixed(1)} 0 0 1 ${x3.toFixed(1)} ${y3.toFixed(1)} L${x4.toFixed(1)} ${y4.toFixed(1)} A${INNER} ${INNER} 0 0 0 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
}

export interface MonthDialProps {
  year: number;
  minutes: number[];
  episodes: number[];
  films: number[];
  recordMonth: number | null;
  currentMonth: number;
  totalMinutes: number;
  play: boolean;
  /** Retour v1.4.294 : « sur 12 mois » en vue glissante, sinon « en 2026 ». */
  periodLabel?: string;
  /** Année de chaque mois en vue glissante (les mois après le mois en cours viennent de l'année précédente). */
  monthYears?: number[];
}

const hours = (minutes: number) => Math.round(minutes / 60);
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

/**
 * SEENIT-PROFILE-003/005 : cadran des douze mois. Les secteurs poussent depuis le centre à l'ouverture, le total
 * compte jusqu'à sa valeur ; toucher un mois le détache et affiche son détail au centre, un second toucher ou le
 * centre revient à l'année. Toutes les animations portent sur transform et opacity.
 */
export function MonthDial(props: MonthDialProps) {
  const [replay, setReplay] = useState(0);
  return <DialBody key={replay} {...props} onReplay={() => setReplay(value => value + 1)} />;
}

function DialBody({ year, minutes, episodes, films, recordMonth, currentMonth, totalMinutes, play, periodLabel, monthYears, onReplay }: MonthDialProps & { onReplay: () => void }) {
  const monthName = (month: number) => `${PROFILE_MONTH_LABELS[month]}${monthYears && monthYears[month] !== year ? ` ${monthYears[month]}` : ''}`;
  const period = periodLabel ?? `en ${year}`;
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...minutes);
  const pickedKnown = picked !== null && picked < minutes.length;
  const target = picked === null ? hours(totalMinutes) : pickedKnown ? hours(minutes[picked]) : 0;
  const shown = useCountUp(target, play);
  const detail = picked === null ? 'devant l’écran'
    : !pickedKnown ? 'à venir'
    : minutes[picked] <= 0 ? 'rien regardé'
    : [films[picked] ? plural(films[picked], 'film') : null, episodes[picked] ? `${episodes[picked]} ép.` : null].filter(Boolean).join(' · ');
  const summary = PROFILE_MONTH_LABELS.map((_, month) => month < minutes.length ? `${monthName(month).toLowerCase()} ${hours(minutes[month])}` : null).filter(Boolean).join(', ');
  return (
    <div className="moi-dial" data-play={play} data-picked={picked !== null}>
      <svg viewBox="0 0 322 322" aria-hidden="true">
        <defs><linearGradient id="moi-dial-gold" x1="10%" y1="5%" x2="90%" y2="95%"><stop offset="0%" stopColor="#FFF2B8" /><stop offset="32%" stopColor="#F5C518" /><stop offset="70%" stopColor="#E5A93D" /><stop offset="100%" stopColor="#B37812" /></linearGradient></defs>
        {MONTH_DIAL.guides.map(radius => <circle key={radius} cx={CENTER} cy={CENTER} r={radius} className="moi-dial-guide" />)}
        {MONTH_SHORT.map((_, month) => {
          const known = month < minutes.length;
          const value = known ? minutes[month] : 0;
          const outer = INNER + (value > 0 ? Math.max(5, value / max * MAX_GROWTH) : 5);
          const angle = (month * 30 + 15) * Math.PI / 180;
          const state = !known ? 'future' : month === recordMonth ? 'record' : month === currentMonth ? 'current' : value <= 0 ? 'empty' : value / max >= 0.45 ? 'high' : 'low';
          return (
            <g key={month} className="moi-dial-sector" data-state={state} data-on={picked === month} style={{ '--delay': `${month * 55}ms`, '--dx': `${(POP * Math.sin(angle)).toFixed(1)}px`, '--dy': `${(-POP * Math.cos(angle)).toFixed(1)}px` } as CSSProperties}>
              <path d={sectorPath(month, outer)} />
              {state === 'current' && <path className="moi-dial-pulse" d={sectorPath(month, outer)} />}
            </g>
          );
        })}
        {/* Retour terrain v1.4.293 : toucher un secteur, même fin, ouvre son mois comme son étiquette. */}
        {MONTH_SHORT.map((label, month) => <path key={label} className="moi-dial-hit" data-month={month} d={sectorPath(month, MONTH_DIAL.hitRadius)} onClick={() => setPicked(current => current === month ? null : month)} />)}
      </svg>
      <button type="button" className="moi-dial-center" onClick={() => { if (picked === null) onReplay(); else setPicked(null); }}
        aria-label={picked === null ? `${period} : ${hours(totalMinutes)} heures. Rejouer l’animation` : 'Revenir au total'}>
        <span>{picked === null ? period : monthName(picked).toLowerCase()}</span>
        <strong>{pickedKnown || picked === null ? `${shown} h` : '–'}</strong>
        <small>{detail}</small>
      </button>
      {MONTH_SHORT.map((label, month) => {
        const [x, y] = point(LABEL_RADIUS, month * 30 + 15);
        const known = month < minutes.length;
        return (
          // Revue Codex #944 : position en pourcentage du cadran, qui peut rétrécir sous 322 px (écran de 360 px).
          <button key={label} type="button" className="moi-dial-month" style={{ left: `${(x / 322 * 100).toFixed(2)}%`, top: `${(y / 322 * 100).toFixed(2)}%` }}
            data-state={!known ? 'future' : month === recordMonth ? 'record' : month === currentMonth ? 'current' : minutes[month] <= 0 ? 'empty' : 'past'}
            aria-pressed={picked === month} aria-label={`${monthName(month)} : ${known ? `${hours(minutes[month])} heures` : 'à venir'}`}
            onClick={() => setPicked(current => current === month ? null : month)}>
            <span>{label}</span><b>{known ? hours(minutes[month]) : '–'}</b>
          </button>
        );
      })}
      <span className="sr-only">Heures par mois {period} : {summary}.</span>
    </div>
  );
}
