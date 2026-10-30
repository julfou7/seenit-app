import React, { useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useProAnalytics, type PersonStat } from '../hooks/useProAnalytics';
import { type Show } from '../types';
import {
  PROFILE_MONTH_LABELS,
  PROFILE_WEEKDAY_LABELS,
  buildProfileBadges,
  buildProfileYearStats,
  collectProfileViewings,
  defaultProfileYear,
  formatProfileHours,
  formatProfilePunchSlot,
  listProfileYears,
} from '../features/profile/profileYearStats';

const BAR_MAX_HEIGHT = 92;
const PEOPLE_PREVIEW = 3;

function PeopleList({ title, people, onPersonClick }: {
  title: string;
  people: PersonStat[];
  onPersonClick?: (personId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (people.length === 0) return null;
  return (
    <div>
      <h4 className="moi-subhead">{title}</h4>
      {(expanded ? people : people.slice(0, PEOPLE_PREVIEW)).map(person => (
        <button
          key={person.id}
          type="button"
          className="moi-person"
          onClick={() => onPersonClick?.(person.id)}
          aria-label={`Voir la filmographie de ${person.name}`}
        >
          {person.profile_path
            ? <img src={`https://image.tmdb.org/t/p/w185${person.profile_path}`} alt="" loading="lazy" decoding="async" />
            : <i aria-hidden="true">{person.name.charAt(0)}</i>}
          <span>
            <strong>{person.name}</strong>
            <small>{person.subtitle || `${person.count} ${person.count > 1 ? 'œuvres vues' : 'œuvre vue'}`}</small>
          </span>
        </button>
      ))}
      {people.length > PEOPLE_PREVIEW && (
        <button type="button" className="moi-link" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Réduire' : `Voir les ${people.length}`}
        </button>
      )}
    </div>
  );
}

export function ProAnalyticsDashboard({
  shows,
  libraryReady = true,
  onPersonClick
}: {
  shows: Show[];
  libraryReady?: boolean;
  onPersonClick?: (personId: number) => void;
}) {
  const { data, loading } = useProAnalytics(shows, libraryReady);
  const viewings = useMemo(() => collectProfileViewings(shows), [shows]);
  const years = useMemo(() => listProfileYears(viewings), [viewings]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const year = pickedYear !== null && years.includes(pickedYear) ? pickedYear : defaultProfileYear(viewings);
  const stats = useMemo(() => buildProfileYearStats(viewings, year), [viewings, year]);
  const badges = useMemo(() => data ? buildProfileBadges(data) : [], [data]);

  const isCurrentYear = year === new Date().getFullYear();
  const days = Math.floor(stats.minutes / 1440);
  const maxMonth = Math.max(1, ...stats.months);
  const average = stats.months.length > 0 ? stats.months.reduce((sum, value) => sum + value, 0) / stats.months.length : 0;
  const maxShare = Math.max(1, ...stats.platforms.map(platform => platform.share));
  const unlockedBadges = badges.filter(badge => badge.unlocked).length;

  const cycleYear = () => {
    const index = years.indexOf(year);
    setPickedYear(years[(index + 1) % years.length]);
    setSelectedMonth(null);
  };

  return (
    <div className="moi-stats">
      <div className="moi-stats-top">
        <span>{isCurrentYear ? 'Depuis le 1er janvier' : `En ${year}`}</span>
        <button
          type="button"
          className="moi-year"
          onClick={cycleYear}
          disabled={years.length < 2}
          aria-label={years.length < 2 ? `Année ${year}` : `Année ${year}, changer d’année`}
        >
          {year}
          {years.length > 1 && <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" />}
        </button>
      </div>

      <div className="moi-bento">
        <div className="moi-hero">
          <span>Devant l’écran</span>
          <div>
            <strong data-long={formatProfileHours(stats.minutes).length > 5}>{formatProfileHours(stats.minutes)}</strong>
            <small>
              {days >= 1 ? `soit ${days} ${days > 1 ? 'jours pleins' : 'jour plein'}` : stats.minutes > 0 ? 'moins d’un jour plein' : `rien de vu en ${year}`}
            </small>
          </div>
        </div>
        <div className="moi-mini">
          <strong>{stats.episodes.toLocaleString('fr-FR')}</strong>
          <span>{stats.episodes > 1 ? 'épisodes vus' : 'épisode vu'}</span>
        </div>
        <div className="moi-mini">
          <strong>{stats.films.toLocaleString('fr-FR')}</strong>
          <span>{stats.films > 1 ? 'films vus' : 'film vu'}</span>
        </div>
      </div>

      <section className="moi-card">
        <div className="moi-card-head">
          <h3>Heures par mois</h3>
          <small>moyenne {formatProfileHours(average)}</small>
        </div>
        <div className="moi-bars">
          {stats.months.map((minutes, month) => {
            const height = Math.round(minutes / maxMonth * BAR_MAX_HEIGHT);
            const selected = selectedMonth === month;
            const record = stats.recordMonth === month;
            const labelled = selected || (record && selectedMonth === null);
            const edge = month < 2 ? 'start' : month > stats.months.length - 3 ? 'end' : undefined;
            return (
              <button
                key={month}
                type="button"
                className="moi-bar"
                data-strong={selected || record}
                aria-pressed={selected}
                aria-label={`${PROFILE_MONTH_LABELS[month]} · ${formatProfileHours(minutes)}`}
                onClick={() => setSelectedMonth(current => current === month ? null : month)}
              >
                {labelled && (
                  <span className="moi-bar-label" data-edge={edge} style={{ bottom: height + 22 }}>
                    {selected ? PROFILE_MONTH_LABELS[month] : 'Record'} · {formatProfileHours(minutes)}
                  </span>
                )}
                <i style={{ height }} />
                <span>{PROFILE_MONTH_LABELS[month].charAt(0)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="moi-card">
        <div className="moi-card-head">
          <h3>Quand tu regardes</h3>
          <small>taille = temps</small>
        </div>
        <div className="moi-punch" role="img" aria-label={stats.punch.slot ? `Créneau le plus regardé : ${formatProfilePunchSlot(stats.punch.slot)}` : 'Aucune heure de visionnage connue'}>
          <span />
          {stats.punch.hours.map(hour => <span key={hour} className="moi-punch-hour">{hour}</span>)}
          {stats.punch.rows.map((row, day) => (
            <React.Fragment key={day}>
              <span className="moi-punch-day">{PROFILE_WEEKDAY_LABELS[day]}</span>
              {row.map((value, index) => {
                const size = value === 0 ? 4 : Math.round(6 + value * 18);
                return (
                  <div key={index} className="moi-punch-cell">
                    <i style={{ width: size, height: size, background: value === 0 ? '#27272a' : `rgba(229,169,61,${(0.3 + value * 0.7).toFixed(2)})` }} />
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <p className="moi-note">
          {stats.punch.slot
            ? <>Ton créneau : <b>{formatProfilePunchSlot(stats.punch.slot)}</b>.</>
            : 'Les heures apparaissent dès qu’un visionnage est daté à la minute.'}
        </p>
      </section>

      <section className="moi-card">
        <div className="moi-card-head"><h3>Où tu regardes</h3></div>
        {stats.platforms.length > 0 ? stats.platforms.map(platform => (
          <div key={platform.name} className="moi-where">
            <span>{platform.name}</span>
            <span className="moi-track">
              <i style={{ width: `${Math.round(platform.share / maxShare * 100)}%`, opacity: platform.name === 'Autres' ? 0.45 : 1 }} />
            </span>
            <small>{platform.share} %</small>
          </div>
        )) : <p className="moi-note">Rien de vu en {year} pour l’instant.</p>}
      </section>

      <section className="moi-card">
        <div className="moi-card-head">
          <h3>Badges</h3>
          {data && <small>{unlockedBadges} sur {badges.length}</small>}
        </div>
        {data ? (
          <div className="moi-badges">
            {badges.map(badge => {
              const percent = Math.round(badge.progress * 100);
              return (
                <div key={badge.id} className="moi-badge" data-unlocked={badge.unlocked}>
                  <span
                    className="moi-ring"
                    style={{ background: `conic-gradient(${badge.unlocked ? '#E5A93D' : 'rgba(229,169,61,0.55)'} ${percent}%, #27272a 0)` }}
                    aria-hidden="true"
                  >
                    <span>{badge.unlocked ? '✓' : `${percent} %`}</span>
                  </span>
                  <strong>{badge.title}</strong>
                  <small>{badge.detail}</small>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="moi-loading"><Loader2 size={13} className="animate-spin text-[#E5A93D]" />Calcul en cours…</span>
        )}
      </section>

      {data && (data.topActors.length > 0 || data.topDirectors.length > 0) ? (
        <section className="moi-card">
          <div className="moi-card-head">
            <h3>Personnes fréquentes</h3>
            {loading && <small>mise à jour…</small>}
          </div>
          <PeopleList title="Acteurs" people={data.topActors} onPersonClick={onPersonClick} />
          <PeopleList title="Créateurs et réalisateurs" people={data.topDirectors} onPersonClick={onPersonClick} />
        </section>
      ) : loading && (
        <section className="moi-card">
          <div className="moi-card-head"><h3>Personnes fréquentes</h3></div>
          <span className="moi-loading"><Loader2 size={13} className="animate-spin text-[#E5A93D]" />Calcul en cours…</span>
        </section>
      )}
    </div>
  );
}
