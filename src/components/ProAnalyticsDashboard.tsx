import React, { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useProAnalytics } from '../hooks/useProAnalytics';
import { type Show } from '../types';
import { tmdb } from '../features/shows/tmdb';
import { getProfileAnalyticsMediaKey } from '../features/profile/profileAnalyticsSnapshot';
import {
  PROFILE_MONTH_LABELS,
  PROFILE_WEEKDAY_LABELS,
  buildProfileYearStats,
  collectProfileViewings,
  countUndatedProfileViewings,
  defaultProfileYear,
  formatProfileHours,
  formatProfileImportNote,
  formatProfilePunchSlot,
  formatProfileUndatedNote,
  listProfileYearTotals,
  partitionProfileViewings,
} from '../features/profile/profileYearStats';
import {
  PROFILE_REACTIONS,
  buildGenreShares,
  buildLeadActors,
  buildProfileInsights,
  buildProfileReactions,
  buildProfileRhythm,
  buildProfileStreaks,
  buildTieredBadges,
  buildTypicalDay,
  buildWeeklyTrend,
  countNightViewings,
  leadCastFromDetails,
} from '../features/profile/profileDashboard';
import { summarizeSeriesFate, type SeriesFateEntry } from '../features/profile/profileSeriesFate';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';
import { MonthDial } from './profile/MonthDial';
import { useReveal } from './profile/useReveal';

const delay = (ms: number) => ({ '--delay': `${ms}ms` }) as CSSProperties;
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Bloc qui s'anime une fois à son entrée dans l'écran (SEENIT-PROFILE-005). */
function Reveal({ className = 'moi-card', label, children }: { className?: string; label?: string; children: (seen: boolean) => ReactNode }) {
  const { ref, seen } = useReveal<HTMLElement>();
  return <section ref={ref} className={`${className} moi-reveal`} data-seen={seen} aria-label={label}>{children(seen)}</section>;
}

function Head({ title, note }: { title: string; note?: string }) {
  return <div className="moi-card-head"><h3>{title}</h3>{note && <small>{note}</small>}</div>;
}

export function ProAnalyticsDashboard({
  shows,
  fate,
  libraryReady = true,
  onPersonClick,
  onFate,
}: {
  shows: Show[];
  fate: readonly SeriesFateEntry[];
  libraryReady?: boolean;
  onPersonClick?: (personId: number) => void;
  onFate?: () => void;
}) {
  const { data, loading, contributions } = useProAnalytics(shows, libraryReady);
  const { viewings, imports } = useMemo(() => partitionProfileViewings(collectProfileViewings(shows)), [shows]);
  const yearTotals = useMemo(() => listProfileYearTotals(viewings), [viewings]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [yearMenuOpen, setYearMenuOpen] = useState(false);
  const now = Date.now();
  const year = pickedYear !== null && yearTotals.some(entry => entry.year === pickedYear) ? pickedYear : defaultProfileYear(viewings);
  const stats = useMemo(() => buildProfileYearStats(viewings, year), [viewings, year]);
  const yearViewings = useMemo(() => viewings.filter(viewing => new Date(viewing.watchedAt).getFullYear() === year), [viewings, year]);
  const showsById = useMemo(() => new Map(shows.map(show => [show.id, show])), [shows]);
  // Revue Codex #944 : genres et rôles principaux viennent des contributions persistées des statistiques (tous les
  // titres vus) ; les caches de détails ne servent qu'en repli pour un titre pas encore réconcilié.
  const details = (show: Show | undefined) => show?.tmdbId ? tmdb.peekRenderableMediaDetails(show.tmdbId, show.mediaType) : null;
  const contributionOf = (show: Show | undefined) => show ? contributions?.[getProfileAnalyticsMediaKey(show)]?.value ?? null : null;
  const genreOf = (showId: string) => {
    const show = showsById.get(showId);
    const known = contributionOf(show)?.genres.find(Boolean);
    if (known) return known;
    const genres = (details(show) as { genres?: { name?: string }[] } | null)?.genres;
    return genres?.find(genre => genre?.name)?.name ?? null;
  };
  const leadsOf = (show: Show) => {
    const actors = contributionOf(show)?.actors;
    return actors?.length ? actors.slice(0, 3).map(actor => ({ id: actor.id, name: actor.name, profile_path: actor.profile_path })) : leadCastFromDetails(details(show), show.mediaType);
  };
  const rhythm = useMemo(() => buildProfileRhythm(viewings, now), [viewings]);
  const typicalDay = useMemo(() => buildTypicalDay(yearViewings), [yearViewings]);
  const streaks = useMemo(() => buildProfileStreaks(viewings, now), [viewings]);
  const weeks = useMemo(() => buildWeeklyTrend(viewings, now), [viewings]);
  const insights = buildProfileInsights(viewings, now, genreOf);
  const genres = buildGenreShares(yearViewings, now, genreOf);
  const reactions = useMemo(() => buildProfileReactions(shows), [shows]);
  const leads = buildLeadActors(yearViewings, shows, leadsOf);
  const fallbackLeads = data?.topActors.slice(0, 3) ?? [];
  const badges = useMemo(() => data ? buildTieredBadges({
    centenaire: data.totalEpisodesSeen + data.totalMoviesSeen,
    night_owl: countNightViewings(viewings),
    big_screen: data.totalMoviesSeen,
    binge_master: data.completedTvCount,
  }) : [], [data, viewings]);
  const fateSummary = useMemo(() => summarizeSeriesFate(fate), [fate]);
  const importNote = formatProfileImportNote(imports, year);
  const undatedNote = useMemo(() => formatProfileUndatedNote(countUndatedProfileViewings(shows)), [shows]);

  const isCurrentYear = year === new Date(now).getFullYear();
  const fullDays = Math.floor(stats.minutes / 1440);
  const maxWeek = Math.max(1, ...weeks.map(week => week.minutes));
  const seriesShare = stats.minutes > 0 ? Math.round(stats.seriesMinutes / stats.minutes * 100) : 0;
  const maxGenre = Math.max(1, ...genres.map(genre => genre.share));
  const maxShare = Math.max(1, ...stats.platforms.map(platform => platform.share));
  const topBucket = fateSummary.buckets.reduce((best, bucket) => bucket.count > best.count ? bucket : best, fateSummary.buckets[0]);
  const pickYear = (next: number) => { setPickedYear(next); setYearMenuOpen(false); };

  return (
    <div className="moi-stats">
      <div className="moi-stats-top">
        <span>{isCurrentYear ? 'Depuis le 1er janvier' : `En ${year}`}</span>
        <div className="moi-year-picker">
          <button type="button" className="moi-year" onClick={() => setYearMenuOpen(open => !open)} disabled={yearTotals.length < 2}
            aria-haspopup="listbox" aria-expanded={yearMenuOpen} aria-label={yearTotals.length < 2 ? `Année ${year}` : `Année ${year}, choisir une autre année`}>
            {year}{yearTotals.length > 1 && <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" />}
          </button>
          {yearMenuOpen && <>
            <button type="button" className="moi-year-backdrop" aria-label="Fermer la liste des années" onClick={() => setYearMenuOpen(false)} />
            <ul className="moi-year-menu" role="listbox" aria-label="Années" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setYearMenuOpen(false); } }}>
              {yearTotals.map(entry => <li key={entry.year}>
                <button type="button" role="option" aria-selected={entry.year === year} onClick={() => pickYear(entry.year)} ref={entry.year === year ? element => element?.focus() : undefined}>
                  <span>{entry.year}</span><small>{entry.minutes > 0 ? formatProfileHours(entry.minutes) : '—'}</small>
                </button>
              </li>)}
            </ul>
          </>}
        </div>
      </div>

      {/* 1. Heures par mois : cadran interactif */}
      <Reveal className="moi-card moi-card--gold moi-dial-card" label="Heures par mois">
        {seen => <>
          <span className="moi-eyebrow">Heures par mois</span>
          <MonthDial key={year} year={year} minutes={stats.months} episodes={stats.monthEpisodes} films={stats.monthFilms} recordMonth={stats.recordMonth}
            currentMonth={isCurrentYear ? new Date(now).getMonth() : -1} totalMinutes={stats.minutes} play={seen} />
          <div className="moi-dial-facts">
            <span><b>{stats.episodes.toLocaleString('fr-FR')}</b><small>{stats.episodes > 1 ? 'épisodes' : 'épisode'}</small></span>
            <span><b>{stats.films.toLocaleString('fr-FR')}</b><small>{stats.films > 1 ? 'films' : 'film'}</small></span>
            <span><b>{fullDays} {fullDays > 1 ? 'jours' : 'jour'}</b><small>pleins</small></span>
          </div>
          {isCurrentYear && stats.months.length > 0 && <p className="moi-note moi-center">{`${PROFILE_MONTH_LABELS[new Date(now).getMonth()]} en cours : `}<b>{formatProfileHours(stats.months[stats.months.length - 1])}</b>. Touche un mois pour voir son détail.</p>}
        </>}
      </Reveal>

      {/* 2. Trois repères */}
      <Reveal className="moi-tiles" label="Trois repères">
        {() => <>
          <div className="moi-tile moi-pop" style={delay(100)}><span>Rythme</span><strong>{formatProfileHours(rhythm.perWeekMinutes)}</strong><small>par semaine</small>{rhythm.change !== null && <em data-trend={rhythm.change >= 0 ? 'up' : 'down'}>{rhythm.change >= 0 ? '▲' : '▼'} {Math.abs(rhythm.change)} %</em>}</div>
          {typicalDay && <div className="moi-tile moi-pop" style={delay(210)}><span>Journée type</span><strong>{formatProfileHours(typicalDay.minutes)}</strong><small>{typicalDay.titles} {typicalDay.titles > 1 ? 'titres' : 'titre'}</small><em>{typicalDay.days} {typicalDay.days > 1 ? 'jours' : 'jour'}</em></div>}
          <div className="moi-tile moi-pop" style={delay(320)}><span>D’affilée</span><strong>{streaks.current} {streaks.current > 1 ? 'jours' : 'jour'}</strong><small>en cours</small><em>record {streaks.record}</em></div>
        </>}
      </Reveal>

      {/* 3. Tendances */}
      {weeks.some(week => week.minutes > 0) && <Reveal label="Tendances">
        {() => <>
          <Head title="Tendances" note="12 dernières semaines" />
          <span className="moi-caption">Heures par semaine</span>
          <div className="moi-weeks" role="img" aria-label={`Heures par semaine sur douze semaines : ${weeks.map(week => Math.round(week.minutes / 60)).join(', ')}`}>
            {weeks.map((week, index) => (
              <span key={week.start} className="moi-week" data-recent={index >= weeks.length - 4} data-last={index === weeks.length - 1} aria-hidden="true">
                <b>{Math.round(week.minutes / 60)}</b>
                <i className="moi-grow-y" style={{ height: Math.max(3, Math.round(week.minutes / maxWeek * 80)), ...delay(120 + index * 55) }} />
              </span>
            ))}
          </div>
          <div className="moi-axis"><span>depuis le {dayMonth.format(new Date(weeks[0].start))}</span><span>28 derniers jours</span></div>
          {insights.map(insight => <div key={insight.id} className="moi-insight"><span><strong>{insight.title}</strong><small>{insight.detail}</small></span><b className={insight.id === 'rhythm' ? 'moi-glow-text' : undefined}>{insight.value}</b></div>)}
        </>}
      </Reveal>}

      {/* 4. Ce que tu regardes */}
      {stats.minutes > 0 && <Reveal label="Ce que tu regardes">
        {() => <>
          <Head title="Ce que tu regardes" />
          <div className="moi-split moi-grow-x" role="img" aria-label={`Séries ${seriesShare} % du temps, films ${100 - seriesShare} %`} style={delay(100)}>
            {stats.seriesMinutes > 0 && <i data-kind="tv" style={{ width: `${seriesShare}%` }} />}{stats.filmMinutes > 0 && <i data-kind="movie" />}
          </div>
          <div className="moi-split-legend"><span data-kind="tv">Séries · {formatProfileHours(stats.seriesMinutes)} · {seriesShare} %</span><span data-kind="movie">Films · {formatProfileHours(stats.filmMinutes)} · {100 - seriesShare} %</span></div>
          {genres.map((genre, index) => (
            <div key={genre.name} className="moi-where">
              <span>{genre.name}</span>
              <span className="moi-track"><i className={`moi-grow-x${index === 0 ? ' moi-sweep' : ''}`} style={{ width: `${Math.round(genre.share / maxGenre * 100)}%`, ...delay(150 + index * 90) }} /></span>
              <small>{genre.share} %{genre.trend && <em data-trend={genre.trend}>{genre.trend === 'up' ? ' ▲' : genre.trend === 'down' ? ' ▼' : ' ='}</em>}</small>
            </div>
          ))}
        </>}
      </Reveal>}

      {/* 5. Quand tu regardes */}
      <Reveal label="Quand tu regardes">
        {() => <>
          <Head title="Quand tu regardes" note={stats.punch.source === 'plex' ? 'heures de lecture Plex' : 'heure des Vu'} />
          <p className="moi-note">{stats.punch.slot ? <>Ton créneau : <b className="moi-glow-text">{formatProfilePunchSlot(stats.punch.slot)}</b></> : 'Les heures apparaissent dès qu’un visionnage est daté à la minute.'}</p>
          {stats.punch.slot && stats.punch.source === 'mark' && <p className="moi-aside">Calculé à l’heure où tu marques Vu dans l’app, qui peut être bien après le visionnage. Les lectures Plex donnent l’heure réelle et prennent le relais dès qu’elles sont assez nombreuses.</p>}
          <div className="moi-punch" role="img" aria-label={stats.punch.slot ? `Créneau le plus regardé : ${formatProfilePunchSlot(stats.punch.slot)}` : 'Aucune heure de visionnage connue'}>
            <span />
            {stats.punch.hours.map(hour => <span key={hour} className="moi-punch-hour">{hour} h</span>)}
            {stats.punch.rows.map((row, day) => (
              <React.Fragment key={day}>
                <span className="moi-punch-day">{PROFILE_WEEKDAY_LABELS[day]}</span>
                {row.map((value, index) => {
                  const strong = stats.punch.slot?.day === day && stats.punch.hours[index] === stats.punch.slot.fromHour;
                  return <i key={index} className={`moi-punch-cell moi-pop${strong ? ' moi-glow' : ''}`} style={{ background: value === 0 ? '#222226' : `rgba(229,169,61,${(0.22 + value * 0.78).toFixed(2)})`, ...delay(120 + (day + index) * 40) }} />;
                })}
              </React.Fragment>
            ))}
          </div>
        </>}
      </Reveal>

      {/* 6. Où tu regardes */}
      {stats.minutes > 0 && <Reveal label="Où tu regardes">
        {() => <>
          <Head title="Où tu regardes" note="part du temps" />
          {stats.platforms.map((platform, index) => (
            <div key={platform.name} className="moi-where">
              <span>{platform.name}</span>
              <span className="moi-track"><i className={`moi-grow-x${index === 0 ? ' moi-sweep' : ''}`} style={{ width: `${Math.round(platform.share / maxShare * 100)}%`, ...delay(150 + index * 90) }} /></span>
              <small>{platform.share} %</small>
            </div>
          ))}
          {stats.unknownPlatformShare > 0 && <p className="moi-aside">Le reste, {stats.unknownPlatformShare} % de ton temps, n’a <b>pas de plateforme connue</b>.</p>}
        </>}
      </Reveal>}

      {/* 7. Séries laissées en route */}
      {fateSummary.left.length > 0 && <Reveal className="moi-card moi-card--gold" label="Séries laissées en route">
        {() => <>
          <div className="moi-card-head moi-card-head--stack"><h3>Séries laissées en route</h3><small>Sur {fateSummary.inProgress} en cours, <b>{fateSummary.paused.length} n’ont plus bougé depuis 2 mois</b> · {fateSummary.dropped.length} {fateSummary.dropped.length > 1 ? 'abandonnées' : 'abandonnée'}</small></div>
          {fateSummary.left.slice(0, 2).map((entry, index) => (
            <div key={entry.show.id} className="moi-fate-item moi-fate-item--static">
              {imageUrl(entry.show.posterPath, 'w92') ? <img src={imageUrl(entry.show.posterPath, 'w92')!} alt="" loading="lazy" decoding="async" /> : <span className="moi-fate-poster" aria-hidden="true" />}
              <span className="moi-fate-text"><strong>{entry.show.title}</strong><small>{entry.nextCode ? `Arrêtée avant ${entry.nextCode}` : 'Abandonnée'}</small>
                {entry.progress > 0 && <span className="moi-track"><i className="moi-grow-x" style={{ width: `${Math.round(entry.progress * 100)}%`, ...delay(150 + index * 90) }} /></span>}</span>
            </div>
          ))}
          {topBucket && topBucket.count > 0 && <p className="moi-note">Tu décroches le plus souvent <b>{topBucket.label.toLowerCase()}</b>.</p>}
          <button type="button" className="moi-primary" onClick={onFate}>Voir les {fateSummary.left.length} séries</button>
        </>}
      </Reveal>}

      {/* 8. Tes réactions : absente sous dix épisodes notés */}
      {reactions && <Reveal label="Tes réactions">
        {() => <>
          <Head title="Tes réactions" note={`${reactions.total} épisodes notés`} />
          <div className="moi-split moi-split--reactions moi-grow-x" style={delay(100)}>{PROFILE_REACTIONS.map(([key]) => reactions.counts[key] > 0 && <i key={key} data-reaction={key} style={{ flexGrow: reactions.counts[key] }} />)}</div>
          <div className="moi-split-legend">{PROFILE_REACTIONS.map(([key, label]) => <span key={key} data-reaction={key}>{label} · {reactions.counts[key]}</span>)}</div>
          {reactions.loved.length > 0 && <div className="moi-loved">{reactions.loved.map((entry, index) => (
            <span key={entry.show.id} className="moi-pop" style={delay(150 + index * 110)}>
              {imageUrl(entry.show.posterPath, 'w185') ? <img src={imageUrl(entry.show.posterPath, 'w185')!} alt="" loading="lazy" decoding="async" /> : <i aria-hidden="true" />}
              <strong>{entry.show.title}</strong><small className={index === 0 ? 'moi-glow-text' : undefined}>{entry.count} J’adore</small>
            </span>
          ))}</div>}
        </>}
      </Reveal>}

      {/* 9. Tes têtes d'affiche */}
      {(leads.length > 0 || fallbackLeads.length > 0) ? <Reveal label="Tes têtes d’affiche">
        {() => <>
          <Head title="Tes têtes d’affiche" note={leads.length > 0 ? 'rôles principaux' : 'titres vus'} />
          {leads.length > 0 ? leads.map((person, index) => (
            <button key={person.id} type="button" className="moi-person" onClick={() => onPersonClick?.(person.id)} aria-label={`Voir la filmographie de ${person.name}`}>
              {person.profile_path ? <img src={`https://image.tmdb.org/t/p/w185${person.profile_path}`} alt="" loading="lazy" decoding="async" /> : <i aria-hidden="true">{person.name.charAt(0)}</i>}
              <span><strong>{person.name}</strong><small>{person.titles} {person.titles > 1 ? 'titres vus' : 'titre vu'}{person.favorites > 0 ? ` · ${person.favorites} ${person.favorites > 1 ? 'favoris' : 'favori'}` : ''}</small></span>
              <b className={index === 0 ? 'moi-glow-text' : undefined}>{formatProfileHours(person.minutes)}</b>
            </button>
          )) : fallbackLeads.map(person => (
            <button key={person.id} type="button" className="moi-person" onClick={() => onPersonClick?.(person.id)} aria-label={`Voir la filmographie de ${person.name}`}>
              {person.profile_path ? <img src={`https://image.tmdb.org/t/p/w185${person.profile_path}`} alt="" loading="lazy" decoding="async" /> : <i aria-hidden="true">{person.name.charAt(0)}</i>}
              <span><strong>{person.name}</strong><small>{person.subtitle || `${person.count} ${person.count > 1 ? 'œuvres vues' : 'œuvre vue'}`}</small></span>
            </button>
          ))}
          {loading && <small className="moi-note">mise à jour…</small>}
        </>}
      </Reveal> : loading && <section className="moi-card"><Head title="Tes têtes d’affiche" /><span className="moi-loading"><Loader2 size={13} className="animate-spin text-[#E5A93D]" />Calcul en cours…</span></section>}

      {/* 10. Badges à niveaux */}
      <Reveal label="Badges">
        {() => <>
          <Head title="Badges" note="prochain palier" />
          {data ? <div className="moi-badges">
            {badges.map(badge => (
              <div key={badge.id} className="moi-badge">
                <span className="moi-ring" style={{ background: `conic-gradient(#E5A93D ${Math.round(badge.progress * 100)}%, #27272a 0)` }} role="img"
                  aria-label={`${badge.title}, niveau ${badge.level}, ${Math.round(badge.progress * 100)} % du palier suivant`}><span>{badge.level}</span></span>
                <strong>{badge.title}</strong><small>{badge.detail}</small>
              </div>
            ))}
          </div> : <span className="moi-loading"><Loader2 size={13} className="animate-spin text-[#E5A93D]" />Calcul en cours…</span>}
        </>}
      </Reveal>

      {(importNote || undatedNote) && <p className="moi-import">{[importNote, undatedNote].filter(Boolean).join(' · ')}</p>}
    </div>
  );
}
