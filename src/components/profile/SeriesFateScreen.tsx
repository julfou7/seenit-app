import { useMemo, useState } from 'react';
import type { Show } from '../../types';
import { formatProfileHours } from '../../features/profile/profileYearStats';
import { summarizeSeriesFate, type SeriesFateEntry } from '../../features/profile/profileSeriesFate';
import { imageUrl } from '../../features/watchlist/seriesCardPresentation';

const PAUSED_PREVIEW = 3;
const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

function ago(days: number) {
  if (days < 60) return `il y a ${Math.max(1, Math.round(days / 7))} sem.`;
  if (days < 365) return `il y a ${Math.round(days / 30.44)} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

function FateRow({ entry, detail, strong, onOpen }: { entry: SeriesFateEntry; detail: string; strong?: boolean; onOpen: (show: Show) => void }) {
  const poster = imageUrl(entry.show.posterPath, 'w92');
  return (
    <button type="button" className="moi-fate-item" onClick={() => onOpen(entry.show)}>
      {poster ? <img src={poster} alt="" loading="lazy" decoding="async" /> : <span className="moi-fate-poster" aria-hidden="true" />}
      <span className="moi-fate-text">
        <strong>{entry.show.title}</strong>
        <small>{detail}</small>
        {entry.progress > 0 && <span className="moi-track" aria-hidden="true"><i data-muted={entry.fate === 'dropped'} style={{ width: `${Math.round(entry.progress * 100)}%` }} /></span>}
      </span>
      <span className="moi-fate-action" data-strong={strong}>Reprendre</span>
    </button>
  );
}

/** SEENIT-PROFILE-002 : les séries laissées en route, sans animation ; chaque ligne ouvre la fiche. */
export function SeriesFateScreen({ entries, onOpen }: { entries: readonly SeriesFateEntry[]; onOpen: (show: Show) => void }) {
  const summary = useMemo(() => summarizeSeriesFate(entries), [entries]);
  if (!summary.left.length && !summary.nearlyDone.length) {
    return <div className="moi-empty"><strong>Aucune série laissée en route</strong><span>Une série en cours sans épisode vu depuis 60 jours apparaîtra ici.</span></div>;
  }
  const maxBucket = Math.max(1, ...summary.buckets.map(bucket => bucket.count));
  const topBucket = summary.buckets.reduce((best, bucket) => bucket.count > best.count ? bucket : best, summary.buckets[0]);
  return (
    <div className="moi-stats moi-fate">
      {summary.left.length > 0 && <section className="moi-card moi-card--gold">
        <strong className="moi-fate-total">{summary.left.length} {summary.left.length > 1 ? 'séries' : 'série'}</strong>
        <p className="moi-note">{summary.paused.length} en pause depuis plus de 2 mois · {summary.dropped.length} {summary.dropped.length > 1 ? 'abandonnées' : 'abandonnée'}</p>
        <div className="moi-fate-facts">
          <span><b>{formatProfileHours(summary.minutesSpent)}</b><small>déjà passées dessus</small></span>
          {summary.dropPoint !== null && <span><b>Épisode {summary.dropPoint}</b><small>ton point de décrochage</small></span>}
        </div>
      </section>}

      {summary.left.length > 0 && <section className="moi-card">
        <div className="moi-card-head"><h3>Où tu décroches</h3></div>
        {summary.buckets.map(bucket => (
          <div key={bucket.key} className="moi-where" data-strong={bucket === topBucket && bucket.count > 0}>
            <span>{bucket.label}</span>
            <span className="moi-track"><i style={{ width: `${Math.round(bucket.count / maxBucket * 100)}%` }} /></span>
            <small>{bucket.count}</small>
          </div>
        ))}
        {summary.survival !== null && <p className="moi-note">Une série qui passe ta saison 1 a <b>{summary.survival} chance{summary.survival > 1 ? 's' : ''} sur 4</b> d’être encore suivie.</p>}
      </section>}

      {summary.nearlyDone.length > 0 && <section className="moi-card moi-card--gold">
        <span className="moi-eyebrow">Presque finies</span>
        {summary.nearlyDone.map(entry => <FateRow key={entry.show.id} entry={entry} strong onOpen={onOpen}
          detail={`Plus que ${entry.remainingEpisodes} ${entry.remainingEpisodes! > 1 ? 'épisodes' : 'épisode'} · ${formatProfileHours(entry.remainingMinutes!)}`} />)}
      </section>}

      {summary.paused.length > 0 && <PausedList entries={summary.paused} onOpen={onOpen} />}

      {summary.dropped.length > 0 && <section className="moi-card">
        <div className="moi-card-head"><h3>Abandonnées</h3><small>{summary.dropped.length} {summary.dropped.length > 1 ? 'séries' : 'série'} · {formatProfileHours(summary.dropped.reduce((sum, entry) => sum + entry.minutesSpent, 0))}</small></div>
        {summary.dropped.map(entry => <FateRow key={entry.show.id} entry={entry} onOpen={onOpen}
          detail={`${entry.nextCode || (entry.lastSeen ? `S${String(entry.lastSeen.season).padStart(2, '0')} | E${String(entry.lastSeen.episode).padStart(2, '0')}` : '')}${entry.lastSeenAt ? ` · vue pour la dernière fois en ${monthName.format(new Date(entry.lastSeenAt))}` : ''}`} />)}
      </section>}

      <p className="moi-import">En pause : une série en cours sans épisode vu depuis 60 jours. Toucher une ligne ouvre sa fiche, où tu peux l’abandonner ou la reprendre.</p>
    </div>
  );
}

function PausedList({ entries, onOpen }: { entries: readonly SeriesFateEntry[]; onOpen: (show: Show) => void }) {
  const [all, setAll] = useState(false);
  return (
    <section className="moi-card">
      <div className="moi-card-head"><h3>En pause</h3><small>{entries.length} {entries.length > 1 ? 'séries' : 'série'}</small></div>
      {(all ? entries : entries.slice(0, PAUSED_PREVIEW)).map(entry => <FateRow key={entry.show.id} entry={entry} onOpen={onOpen} detail={`${entry.nextCode || ''} · ${ago(entry.pausedDays)}`} />)}
      {!all && entries.length > PAUSED_PREVIEW && <button type="button" className="moi-more" onClick={() => setAll(true)}>Afficher les {entries.length}</button>}
    </section>
  );
}
