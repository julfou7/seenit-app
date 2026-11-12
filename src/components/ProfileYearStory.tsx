import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Show } from '../types';
import {
  PROFILE_MONTH_SHORT,
  buildProfileProjection,
  countUndatedProfileViewings,
  defaultProfileYear,
  formatProfileHours,
  formatProfileImportNote,
  formatProfileScopeNote,
  formatProfileUndatedNote,
  scopeProfileViewings,
} from '../features/profile/profileYearStats';
import { buildMediaMonths, buildProfileCalendar, buildProfileYearRecords, buildTopSeries, buildYearHeadline, buildYearInSeries } from '../features/profile/profileYearRecap';
import { countSeriesFatesInYear, summarizeSeriesFate, type SeriesFateEntry } from '../features/profile/profileSeriesFate';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';
import { useReveal } from './profile/useReveal';
import { LoadMore, useRevealFocus } from './cards/HomeLoadMore';

const SERIES_MONTHS_PREVIEW = 6;
const delay = (ms: number) => ({ '--delay': `${ms}ms` }) as CSSProperties;
const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function Reveal({ className = 'moi-card', label, children }: { className?: string; label?: string; children: ReactNode }) {
  const { ref, seen } = useReveal<HTMLElement>();
  return <section ref={ref} className={`${className} moi-reveal`} data-seen={seen} aria-label={label}>{children}</section>;
}

/** SEENIT-PROFILE-004 : Mon année — calendrier, records, année en séries (jamais de film), films ou séries, top. */
export function ProfileYearStory({ shows, fate, since = null, libraryReady = true, onFate }: { shows: Show[]; fate: readonly SeriesFateEntry[]; since?: number | null; libraryReady?: boolean; onFate?: () => void }) {
  const scope = useMemo(() => scopeProfileViewings(shows, since), [shows, since]);
  const { viewings, imports } = scope;
  const now = Date.now();
  const year = defaultProfileYear(viewings, now);
  const headline = useMemo(() => buildYearHeadline(viewings, year), [viewings, year]);
  const calendar = useMemo(() => buildProfileCalendar(viewings, year, now), [viewings, year]);
  const records = useMemo(() => buildProfileYearRecords(viewings, year), [viewings, year]);
  const seriesMonths = useMemo(() => buildYearInSeries(viewings, shows, year, now), [viewings, shows, year]);
  const media = useMemo(() => buildMediaMonths(viewings, year, now), [viewings, year]);
  const top = useMemo(() => buildTopSeries(viewings, year), [viewings, year]);
  const fates = useMemo(() => countSeriesFatesInYear(fate, viewings, year), [fate, viewings, year]);
  // #946 : les séries presque finies gardent un accès même sans pause ni abandon dans l'année.
  const nearlyDoneCount = useMemo(() => summarizeSeriesFate(fate).nearlyDone.length, [fate]);
  const projection = useMemo(() => buildProfileProjection(shows, viewings.filter(viewing => !viewing.catchUp), now), [shows, viewings]);
  const [allMonths, setAllMonths] = useState(false);
  const monthsReveal = useRevealFocus<HTMLDivElement>('.moi-series-month');
  const importNote = formatProfileImportNote(imports, year);
  const scopeNote = formatProfileScopeNote(scope, year);
  const undatedNote = useMemo(() => formatProfileUndatedNote(countUndatedProfileViewings(shows)), [shows]);

  if (!calendar.record) {
    return (
      <div className="moi-empty">
        <strong>{libraryReady ? 'Ton année commence ici' : 'Chargement…'}</strong>
        {libraryReady && <span>Le récit se remplit dès ton premier épisode ou film vu.</span>}
      </div>
    );
  }

  const maxMedia = Math.max(1, ...media.series.map((value, month) => value + media.films[month]));
  const seriesTotal = media.series.reduce((sum, value) => sum + value, 0), filmTotal = media.films.reduce((sum, value) => sum + value, 0);
  const visibleMonths = allMonths ? seriesMonths : seriesMonths.slice(0, SERIES_MONTHS_PREVIEW);
  const hiddenMonths = seriesMonths.slice(SERIES_MONTHS_PREVIEW);
  const fateParts = [['finished', 'terminées', 'Série terminée'], ['active', 'en cours', 'en cours'], ['paused', 'en pause depuis 2 mois', 'en pause'], ['dropped', 'abandonnées', 'abandonnée']] as const;

  return (
    <div className="moi-stats moi-year-page">
      <div className="moi-year-title">
        <span className="moi-caption">{year === new Date(now).getFullYear() ? 'Ton année, jusqu’ici' : `En ${year}`}</span>
        <h2>{headline.lead ? <>L’année <em>{headline.lead}</em>{headline.second && <>, puis <em>{headline.second}</em></>}</> : `Ton année ${year}`}</h2>
        <p>{headline.summary} devant l’écran</p>
      </div>

      {/* 1. L'année jour par jour */}
      <Reveal className="moi-card moi-card--gold" label={`${year}, jour par jour`}>
        <div className="moi-card-head"><h3>{year}, jour par jour</h3><small>une case = un jour</small></div>
        <div className="moi-calendar" role="img" aria-label={`Calendrier de ${year}, journée record le ${longDate.format(calendar.record.date)}`}>
          {calendar.months.map(month => (
            <div key={month.month} className="moi-calendar-month moi-pop" style={delay(120 + month.month * 70)}>
              <span data-strong={records.month?.month === month.month}>{PROFILE_MONTH_SHORT[month.month]}</span>
              <div>
                {Array.from({ length: month.offset }, (_, index) => <i key={`blank-${index}`} data-blank="true" />)}
                {month.days.map(day => <i key={day.day} data-level={day.level} data-future={day.future} className={day.level === 4 ? 'moi-glow' : undefined} />)}
              </div>
            </div>
          ))}
        </div>
        <div className="moi-calendar-legend" aria-hidden="true"><span>moins</span>{[1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>plus</span></div>
        <p className="moi-aside">Journée record : <b className="moi-glow-text">{longDate.format(calendar.record.date)}, {formatProfileHours(calendar.record.minutes)}</b>{calendar.record.films > 0 || calendar.record.episodes > 0 ? ` · ${[calendar.record.films ? `${calendar.record.films} film${calendar.record.films > 1 ? 's' : ''}` : null, calendar.record.episodes ? `${calendar.record.episodes} épisode${calendar.record.episodes > 1 ? 's' : ''}` : null].filter(Boolean).join(', ')}` : ''}.</p>
      </Reveal>

      {/* 2. Records */}
      <Reveal className="moi-tiles moi-tiles--two" label="Records">
        {records.month && <div className="moi-tile moi-pop" style={delay(100)}><span>Mois record</span><strong className="moi-glow-text">{PROFILE_MONTH_SHORT[records.month.month].charAt(0) + PROFILE_MONTH_SHORT[records.month.month].slice(1).toLowerCase()} · {formatProfileHours(records.month.minutes)}</strong><small>{records.month.films} film{records.month.films > 1 ? 's' : ''}, {records.month.episodes} épisode{records.month.episodes > 1 ? 's' : ''}</small></div>}
        {records.streak && <div className="moi-tile moi-pop" style={delay(210)}><span>Jours d’affilée</span><strong>{records.streak.length} jours</strong><small>du {shortDate.format(records.streak.from)} au {shortDate.format(records.streak.to)}</small></div>}
        {records.marathon && <div className="moi-tile moi-pop" style={delay(320)}><span>Plus gros marathon</span><strong>{records.marathon.episodes} épisodes</strong><small>{records.marathon.title}, le {shortDate.format(records.marathon.date)}</small></div>}
        {records.pause && <div className="moi-tile moi-pop" style={delay(430)}><span>Plus longue pause</span><strong>{records.pause.days} jour{records.pause.days > 1 ? 's' : ''}</strong><small>du {shortDate.format(records.pause.from)} au {shortDate.format(records.pause.to)}</small></div>}
      </Reveal>

      {/* 3. Ton année en séries : uniquement des séries, avec leur affiche */}
      {seriesMonths.length > 0 && <Reveal label="Ton année en séries">
        <div className="moi-card-head moi-card-head--stack"><h3>Ton année en séries</h3><small>Chaque mois, la série que tu as le plus regardée.</small></div>
        <div ref={monthsReveal.containerRef} className="moi-series-months">
        {visibleMonths.map((month, index) => (
          <div key={month.month} className="moi-series-month">
            <b data-current={year === new Date(now).getFullYear() && month.month === new Date(now).getMonth()}>{PROFILE_MONTH_SHORT[month.month]}</b>
            {imageUrl(month.posterPath, 'w92') ? <img src={imageUrl(month.posterPath, 'w92')!} alt="" loading="lazy" decoding="async" /> : <span className="moi-fate-poster" aria-hidden="true" />}
            <span className="moi-fate-text">
              <strong>{month.title}</strong>
              <span className="moi-meter"><span className="moi-track"><i className={`moi-grow-x${month.share === 1 ? ' moi-sweep' : ''}`} style={{ width: `${Math.round(month.share * 100)}%`, ...delay(150 + index * 90) }} /></span><small>{month.episodes} ép. · {formatProfileHours(month.minutes)}</small></span>
              {month.tag && <span className="moi-event" data-strong={month.tag.strong}>{month.tag.label}</span>}
            </span>
          </div>
        ))}
        </div>
        {!allMonths && <LoadMore previews={hiddenMonths.slice(0, 3).map(month => ({ key: `series-month-${month.month}`, initial: month.title.charAt(0), imagePath: month.posterPath }))}
          remainingCount={hiddenMonths.length} step={hiddenMonths.length} lastLabel="Afficher le dernier mois" label={hiddenMonths.length ? `${MONTH_LONG[hiddenMonths[hiddenMonths.length - 1].month].replace(/^./, letter => letter.toUpperCase())} à ${MONTH_LONG[hiddenMonths[0].month]}` : undefined}
          onLoad={() => { setAllMonths(true); monthsReveal.focusItem(SERIES_MONTHS_PREVIEW); }} />}
      </Reveal>}

      {/* 4. Films ou séries, mois par mois */}
      {seriesTotal + filmTotal > 0 && <Reveal label="Films ou séries, mois par mois">
        <div className="moi-card-head"><h3>Films ou séries, mois par mois</h3></div>
        <div className="moi-stack-bars" role="img" aria-label={`Temps par mois : séries ${formatProfileHours(seriesTotal)}, films ${formatProfileHours(filmTotal)}`}>
          {media.series.map((series, month) => (
            <span key={month} className="moi-stack moi-grow-y" style={delay(120 + month * 60)} aria-hidden="true">
              {media.films[month] > 0 && <i data-kind="movie" style={{ height: Math.round(media.films[month] / maxMedia * 104) }} />}
              {series > 0 && <i data-kind="tv" style={{ height: Math.round(series / maxMedia * 104) }} />}
              {series + media.films[month] <= 0 && <i data-kind="empty" />}
              <small>{MONTH_INITIALS[month]}</small>
            </span>
          ))}
        </div>
        <div className="moi-split-legend"><span data-kind="tv">Séries · {formatProfileHours(seriesTotal)}</span><span data-kind="movie">Films · {formatProfileHours(filmTotal)}</span></div>
        {media.insight && <p className="moi-note"><b className="moi-glow-text">{media.insight}</b></p>}
      </Reveal>}

      {/* 5. Tes séries en AAAA */}
      {fates.total > 0 && <Reveal label={`Tes séries en ${year}`}>
        <div className="moi-card-head moi-card-head--stack"><h3>Tes séries en {year}</h3><small>{fates.total} série{fates.total > 1 ? 's' : ''} regardée{fates.total > 1 ? 's' : ''} · que sont-elles devenues ?</small></div>
        <div className="moi-split moi-grow-x" style={delay(100)} role="img" aria-label={fateParts.map(([key, label]) => `${fates[key]} ${label}`).join(', ')}>
          {fateParts.map(([key]) => fates[key] > 0 && <i key={key} data-fate={key} style={{ flexGrow: fates[key] }} />)}
        </div>
        <div className="moi-fate-legend">{fateParts.map(([key, label]) => <span key={key} data-fate={key}>{fates[key]} {label}</span>)}</div>
        {(fates.paused > 0 || fates.dropped > 0 || nearlyDoneCount > 0) && <button type="button" className="moi-secondary" onClick={onFate}>{fates.paused > 0 || fates.dropped > 0 ? 'Voir les séries laissées en route' : 'Voir les séries presque finies'}</button>}
      </Reveal>}

      {/* 6. Ton top de l'année */}
      {top.length > 0 && <Reveal label="Ton top de l’année">
        <div className="moi-card-head"><h3>Ton top de l’année</h3><small>séries, au temps passé</small></div>
        {top.map((entry, index) => (
          <div key={entry.showId} className="moi-top-row moi-pop" style={delay(100 + index * 90)}>
            <b className={index === 0 ? 'moi-glow-text' : undefined} data-podium={index < 3}>{index + 1}</b>
            {imageUrl(entry.posterPath, 'w92') ? <img src={imageUrl(entry.posterPath, 'w92')!} alt="" loading="lazy" decoding="async" /> : <span className="moi-fate-poster" aria-hidden="true" />}
            <span className="moi-fate-text">
              <strong>{entry.title}</strong>
              <span className="moi-meter"><span className="moi-track"><i className="moi-grow-x" style={{ width: `${Math.round(entry.relative * 100)}%`, ...delay(150 + index * 90) }} /></span><small>{formatProfileHours(entry.minutes)}</small></span>
              <small>{entry.episodes} {entry.episodes > 1 ? 'épisodes' : 'épisode'} · {entry.share} % de ton temps séries</small>
            </span>
          </div>
        ))}
      </Reveal>}

      {/* 7. Et maintenant */}
      {projection && <div className="moi-next">
        <span>Et maintenant</span>
        <p>À ce rythme, tu finis {projection.title} le <b>{projection.finishDate}</b>.</p>
        <small>{projection.remaining} {projection.remaining > 1 ? 'épisodes restants' : 'épisode restant'} · {projection.perWeek.toLocaleString('fr-FR')} par semaine en moyenne</small>
      </div>}

      {(scopeNote || importNote || undatedNote) && <p className="moi-import">{[scopeNote, importNote, undatedNote].filter(Boolean).join(' · ')}</p>}
    </div>
  );
}
