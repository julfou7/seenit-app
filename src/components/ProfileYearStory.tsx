import { useMemo } from 'react';
import type { Show } from '../types';
import {
  PROFILE_MONTH_SHORT,
  buildProfileProjection,
  buildProfileYearStory,
  collectProfileViewings,
  defaultProfileYear,
  formatProfileHours,
} from '../features/profile/profileYearStats';

export function ProfileYearStory({ shows, libraryReady = true }: { shows: Show[]; libraryReady?: boolean }) {
  const viewings = useMemo(() => collectProfileViewings(shows), [shows]);
  const year = defaultProfileYear(viewings);
  const story = useMemo(() => buildProfileYearStory(viewings, year), [viewings, year]);
  const projection = useMemo(() => buildProfileProjection(shows, viewings), [shows, viewings]);

  if (!story) {
    return (
      <div className="moi-empty">
        <strong>{libraryReady ? 'Ton année commence ici' : 'Chargement…'}</strong>
        {libraryReady && <span>Le récit se remplit dès ton premier épisode ou film vu.</span>}
      </div>
    );
  }

  return (
    <div className="moi-story">
      {year !== new Date().getFullYear() && <span className="moi-story-year">En {year}</span>}
      <h2>{story.headline}</h2>
      {story.months.map(month => (
        <div key={month.month} className="moi-step">
          <div className="moi-step-rail">
            <b>{PROFILE_MONTH_SHORT[month.month]}</b>
            <i aria-hidden="true" />
          </div>
          <div className="moi-step-body">
            {month.posterPath
              ? <img className="moi-step-poster" src={`https://image.tmdb.org/t/p/w92${month.posterPath}`} alt="" loading="lazy" decoding="async" />
              : <span className="moi-step-poster" aria-hidden="true" />}
            <div className="moi-step-text">
              <strong>{month.title}</strong>
              <div className="moi-step-meter">
                <span className="moi-track"><i style={{ width: `${Math.round(month.share * 100)}%` }} /></span>
                <small>{formatProfileHours(month.minutes)}</small>
              </div>
              {month.event && <span className="moi-event">{month.event}</span>}
            </div>
          </div>
        </div>
      ))}
      {projection && (
        <div className="moi-next">
          <span>Et maintenant</span>
          <p>À ce rythme, tu finis {projection.title} le <b>{projection.finishDate}</b>.</p>
          <small>
            {projection.remaining} {projection.remaining > 1 ? 'épisodes restants' : 'épisode restant'} · {projection.perWeek.toLocaleString('fr-FR')} par semaine en moyenne
          </small>
        </div>
      )}
    </div>
  );
}
