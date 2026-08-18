import React, { useState, useRef } from 'react';
import { Upload, AlertCircle, Loader2, Trash2, RefreshCw, RotateCcw, Search, Edit2, Check, X, Film, Tv } from 'lucide-react';
import Papa from 'papaparse';
import { auth, db } from '../lib/firebase';
import { collection, query, getDocs, doc, setDoc, updateDoc, where } from 'firebase/firestore';
import { useSyncStore } from '../store/syncStore';
import { tmdb, type TMDBMedia } from '../features/shows/tmdb';
import { type Show } from '../types';

interface LocalTask {
  id: string;
  rawTitle: string;
  mediaType: 'tv' | 'movie';
  seenEpisodes: string[];
  status: 'pending' | 'done' | 'failed';
  error?: string;
}

async function smartSearchTMDB(rawTitle: string, mediaType: 'tv' | 'movie'): Promise<{ bestMatch: TMDBMedia; resolvedType: 'tv' | 'movie' } | null> {
  let searchRes = await tmdb.searchMedia(rawTitle, undefined, mediaType);
  if (searchRes.ok && searchRes.value) return { bestMatch: searchRes.value, resolvedType: mediaType };

  const cleanedTitle = rawTitle.replace(/\s*\([^)]*\)/g, '').trim();
  if (cleanedTitle && cleanedTitle !== rawTitle) {
    searchRes = await tmdb.searchMedia(cleanedTitle, undefined, mediaType);
    if (searchRes.ok && searchRes.value) return { bestMatch: searchRes.value, resolvedType: mediaType };
  }

  const altType: 'tv' | 'movie' = mediaType === 'tv' ? 'movie' : 'tv';
  searchRes = await tmdb.searchMedia(rawTitle, undefined, altType);
  if (searchRes.ok && searchRes.value) return { bestMatch: searchRes.value, resolvedType: altType };

  if (cleanedTitle && cleanedTitle !== rawTitle) {
    searchRes = await tmdb.searchMedia(cleanedTitle, undefined, altType);
    if (searchRes.ok && searchRes.value) return { bestMatch: searchRes.value, resolvedType: altType };
  }

  searchRes = await tmdb.searchMedia(rawTitle, undefined, undefined);
  if (searchRes.ok && searchRes.value) {
    const resType = searchRes.value.media_type === 'movie' ? 'movie' : 'tv';
    return { bestMatch: searchRes.value, resolvedType: resType };
  }
  return null;
}

export function CsvImporter() {
  const isQuotaExceeded = useSyncStore(state => state.isQuotaExceeded);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const isProcessingRef = useRef(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    done: tasks.filter(t => t.status === 'done').length,
    failed: tasks.filter(t => t.status === 'failed').length
  };

  const failedTasks = tasks.filter(t => t.status === 'failed');

  const processQueue = async (currentTasks: LocalTask[]) => {
    if (isProcessingRef.current) return;
    if (!auth.currentUser) return;
    
    isProcessingRef.current = true;
    setIsProcessing(true);

    const userUid = auth.currentUser.uid;
    const showsRef = collection(db, 'users', userUid, 'shows');
    let updatedTasks = [...currentTasks];

    for (let i = 0; i < updatedTasks.length; i++) {
      if (!isProcessingRef.current) break;
      const task = updatedTasks[i];
      if (task.status !== 'pending') continue;
      
      try {
        const rawTitle = task.rawTitle;
        if (!rawTitle) {
          updatedTasks[i] = { ...task, status: 'failed', error: 'Titre invalide' };
          setTasks([...updatedTasks]);
          continue;
        }

        let taskSeenEpisodes = [...task.seenEpisodes];

        const searchResult = await smartSearchTMDB(rawTitle, task.mediaType);
        if (!searchResult) {
          updatedTasks[i] = { ...task, status: 'failed', error: `Introuvable sur TMDB ("${rawTitle}")` };
          setTasks([...updatedTasks]);
          continue;
        }

        const { bestMatch, resolvedType } = searchResult;

        const showQ = query(showsRef, where('tmdbId', '==', bestMatch.id));
        const showSnap = await getDocs(showQ);

        if (!showSnap.empty) {
          const existingDoc = showSnap.docs[0];
          const showData = existingDoc.data() as Show;

          if (resolvedType === 'tv') {
            const mergedSeen = new Set(showData.seenEpisodes || []);
            taskSeenEpisodes.forEach(ep => mergedSeen.add(ep));

            const mergedRecords = { ...(showData.episodeRecords || {}) };
            taskSeenEpisodes.forEach(ep => {
              if (!mergedRecords[ep]) {
                mergedRecords[ep] = { watchedAt: Date.now() };
              }
            });

            await updateDoc(existingDoc.ref, {
              seenEpisodes: Array.from(mergedSeen),
              episodeRecords: mergedRecords,
              updatedAt: Date.now()
            });
          } else {
            await updateDoc(existingDoc.ref, {
              status: 'completed',
              updatedAt: Date.now()
            });
          }
        } else {
          const posterToUse = bestMatch.poster_path ? `https://image.tmdb.org/t/p/w342${bestMatch.poster_path}` : null;
          const backdropToUse = bestMatch.backdrop_path ? `https://image.tmdb.org/t/p/w780${bestMatch.backdrop_path}` : null;

          if (resolvedType === 'movie') {
            const newShowData = {
              userId: userUid,
              tmdbId: bestMatch.id,
              title: bestMatch.title || bestMatch.name || rawTitle,
              mediaType: 'movie' as const,
              status: 'completed',
              posterPath: posterToUse,
              backdropPath: backdropToUse,
              isArchived: false,
              updatedAt: Date.now(),
              createdAt: Date.now(),
              seenEpisodes: ['1x1'],
              episodeRecords: { '1x1': { watchedAt: Date.now() } },
              firstAirDate: bestMatch.release_date || bestMatch.first_air_date || null,
              networks: null,
            };
            await setDoc(doc(showsRef), newShowData);
          } else {
            const episodeRecordsObj: Record<string, { watchedAt: number }> = {};
            taskSeenEpisodes.forEach(ep => {
              episodeRecordsObj[ep] = { watchedAt: Date.now() };
            });

            const newShowData = {
              userId: userUid,
              tmdbId: bestMatch.id,
              title: bestMatch.name || bestMatch.title || rawTitle,
              mediaType: 'tv' as const,
              status: 'watching',
              posterPath: posterToUse,
              backdropPath: backdropToUse,
              isArchived: false,
              updatedAt: Date.now(),
              createdAt: Date.now(),
              seenEpisodes: taskSeenEpisodes,
              episodeRecords: episodeRecordsObj,
              firstAirDate: bestMatch.first_air_date || bestMatch.release_date || null,
              networks: null,
            };
            await setDoc(doc(showsRef), newShowData);
          }
        }

        updatedTasks[i] = { ...task, status: 'done', error: undefined };
        setTasks([...updatedTasks]);

        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err: any) {
        console.error("Error processing task:", err);
        updatedTasks[i] = { ...task, status: 'failed', error: err.message || 'Erreur inattendue' };
        setTasks([...updatedTasks]);
      }
    }

    isProcessingRef.current = false;
    setIsProcessing(false);
  };

  const clearTasks = () => {
    isProcessingRef.current = false;
    setTasks([]);
    setError(null);
  };

  const retryAllFailed = async () => {
    if (!auth.currentUser || stats.failed === 0) return;
    setError(null);
    const newTasks = tasks.map(t => t.status === 'failed' ? { ...t, status: 'pending' as const, error: undefined } : t);
    setTasks(newTasks);
    processQueue(newTasks);
  };

  const retrySingleTask = async (taskId: string, newTitle?: string, newType?: 'tv' | 'movie') => {
    const newTasks = tasks.map(t => {
      if (t.id === taskId) {
        return { 
          ...t, 
          status: 'pending' as const, 
          error: undefined,
          rawTitle: newTitle !== undefined ? newTitle.trim() : t.rawTitle,
          mediaType: newType !== undefined ? newType : t.mediaType
        };
      }
      return t;
    });
    setTasks(newTasks);
    setEditingTaskId(null);
    processQueue(newTasks);
  };

  const deleteSingleTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const toggleTaskMediaType = (task: LocalTask) => {
    const nextType: 'tv' | 'movie' = task.mediaType === 'tv' ? 'movie' : 'tv';
    retrySingleTask(task.id, task.rawTitle, nextType);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!auth.currentUser) {
      setError("Vous devez être connecté pour importer des données.");
      return;
    }

    setIsUploading(true);
    setError(null);
    isProcessingRef.current = false;

    try {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          try {
            if (!results.data || results.data.length === 0) {
              throw new Error("Fichier CSV vide ou invalide");
            }

            const fields = results.meta?.fields || (results.data[0] ? Object.keys(results.data[0]) : []);
            const isMoviesFile = fields.some(f => /movie/i.test(f)) && !fields.some(f => /season/i.test(f) || /episode/i.test(f));

            const showMap = new Map<string, { rawTitle: string; seenEpisodes: Set<string> }>();
            const movieMap = new Map<string, { rawTitle: string }>();

            results.data.forEach((row: any) => {
              if (!row || typeof row !== 'object') return;

              const movieTitle = (row.movie_name || row['Movie Name'] || row.movie_title || row['Movie Title'])?.toString()?.trim();
              const showTitle = (row.series_name || row['Series Name'] || row.show_name || row['Show Name'] || row.show_title || row['Show Title'] || row.show || row['Show'] || row.title || row['Title'] || row.name || row['Name'])?.toString()?.trim();
              const seasonVal = row.season_number || row['Season Number'] || row.season || row['Season'] || (Array.isArray(row) ? row[2] : '');
              const epVal = row.episode_number || row['Episode Number'] || row.episode || row['Episode'] || (Array.isArray(row) ? row[3] : '');
              const seasonNum = parseInt(seasonVal, 10);
              const epNum = parseInt(epVal, 10);
              const hasSeasonEp = !isNaN(seasonNum) && !isNaN(epNum);

              if (isMoviesFile || (movieTitle && !hasSeasonEp)) {
                const title = movieTitle || showTitle;
                if (title) {
                  const mapKey = title.toLowerCase();
                  if (!movieMap.has(mapKey)) movieMap.set(mapKey, { rawTitle: title });
                }
              } else if (showTitle) {
                const mapKey = showTitle.toLowerCase();
                if (!showMap.has(mapKey)) {
                  showMap.set(mapKey, { rawTitle: showTitle, seenEpisodes: new Set<string>() });
                }
                if (hasSeasonEp) {
                  showMap.get(mapKey)!.seenEpisodes.add(`${seasonNum}x${epNum}`);
                }
              }
            });

            const tvTasks = Array.from(showMap.values()).map(item => ({
              id: Math.random().toString(36).substring(2, 15),
              rawTitle: item.rawTitle,
              mediaType: 'tv' as const,
              seenEpisodes: Array.from(item.seenEpisodes),
              status: 'pending' as const
            }));

            const movieTasks = Array.from(movieMap.values()).map(item => ({
              id: Math.random().toString(36).substring(2, 15),
              rawTitle: item.rawTitle,
              mediaType: 'movie' as const,
              seenEpisodes: [],
              status: 'pending' as const
            }));

            const tasksToCreate = [...tvTasks, ...movieTasks];
            if (tasksToCreate.length === 0) throw new Error("Aucune série ni film valide trouvé dans le fichier CSV");

            setTasks(tasksToCreate);
            setIsUploading(false);
            event.target.value = '';
            processQueue(tasksToCreate);
          } catch (innerErr: any) {
            setError(innerErr.message || "Erreur lors du traitement du CSV");
            setIsUploading(false);
          }
        },
        error: () => {
          setError("Erreur de parsing du fichier CSV");
          setIsUploading(false);
        }
      });
    } catch (err: any) {
      setError(err.message || "Erreur lors du chargement du fichier");
      setIsUploading(false);
    }
  };

  const filteredFailedTasks = failedTasks.filter(task => 
    task.rawTitle.toLowerCase().includes(searchFilter.toLowerCase()) ||
    (task.error || '').toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4">
      {isQuotaExceeded && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-red-500" />
            <span>Quota Firestore précédemment atteint.</span>
          </div>
          <button 
            onClick={() => useSyncStore.getState().resetQuotaError()}
            className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 font-semibold rounded text-[11px] transition-colors shrink-0"
          >
            Réessayer
          </button>
        </div>
      )}
      
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-xs flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
      
      <div className="flex items-center gap-3">
        <label className={`flex items-center justify-center gap-2 transition-colors py-3 px-6 rounded-xl font-medium text-sm cursor-pointer flex-1 ${
          isUploading || isProcessing || !auth.currentUser
            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white'
        }`}>
          {isUploading || isProcessing ? (
            <><Loader2 size={18} className="animate-spin" /> Traitement du CSV...</>
          ) : (
            <><Upload size={18} /> Importer un CSV TV Time (Séries ou Films)</>
          )}
          <input 
            type="file" 
            accept=".csv" 
            className="hidden" 
            onChange={handleFileUpload} 
            disabled={isUploading || isProcessing || !auth.currentUser}
          />
        </label>

        {stats.failed > 0 && (
          <button
            onClick={retryAllFailed}
            disabled={isProcessing || isUploading}
            title="Réessayer tous les échecs d'import"
            className={`px-4 py-3 font-medium text-sm rounded-xl transition-colors flex items-center gap-2 ${
              isProcessing || isUploading
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white'
            }`}
          >
            {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <RotateCcw size={18} />}
            <span>Réessayer échecs ({stats.failed})</span>
          </button>
        )}

        {stats.total > 0 && (
          <button
            onClick={clearTasks}
            disabled={isUploading}
            title="Effacer l'historique d'importation"
            className={`p-3 rounded-xl transition-colors flex items-center justify-center ${
              isUploading
                ? 'bg-zinc-850 text-zinc-600 cursor-not-allowed border border-zinc-800'
                : 'bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-zinc-300'
            }`}
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>

      {(stats.total > 0) && (
        <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-semibold text-zinc-200">Progression de l'import ({stats.total} éléments)</h4>
            {stats.pending > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                <RefreshCw size={12} className="animate-spin" /> Import rapide en cours...
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col bg-zinc-900/50 p-2.5 rounded-lg border border-zinc-800/50">
              <span className="text-zinc-500 text-xs mb-1">En attente</span>
              <span className="font-medium text-amber-500">{stats.pending}</span>
            </div>
            <div className="flex flex-col bg-zinc-900/50 p-2.5 rounded-lg border border-zinc-800/50">
              <span className="text-zinc-500 text-xs mb-1">Terminés</span>
              <span className="font-medium text-emerald-500">{stats.done}</span>
            </div>
            <div className="flex flex-col bg-zinc-900/50 p-2.5 rounded-lg border border-zinc-800/50">
              <span className="text-zinc-500 text-xs mb-1">Échecs</span>
              <span className="font-medium text-red-500">{stats.failed}</span>
            </div>
          </div>
          
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
             <div 
               className="bg-indigo-500 h-full transition-all duration-300"
               style={{ width: `${stats.total > 0 ? ((stats.done + stats.failed) / stats.total) * 100 : 0}%` }}
             />
          </div>
        </div>
      )}

      {failedTasks.length > 0 && (
        <div className="bg-zinc-950 border border-red-500/20 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
              <AlertCircle size={16} />
              <span>Log des erreurs d'import ({failedTasks.length})</span>
            </div>
            <button
              onClick={retryAllFailed}
              disabled={isProcessing}
              className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-lg border border-amber-500/30 flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={12} />
              <span>Relancer tous les échecs</span>
            </button>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Voici les titres qui n'ont pas pu être trouvés automatiquement sur TMDB. Vous pouvez corriger leur nom, basculer entre Série/Film ou cliquer sur Réessayer.
          </p>

          {failedTasks.length > 5 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Filtrer les titres en échec..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <div className="max-h-80 overflow-y-auto flex flex-col gap-2 pr-1 custom-scrollbar">
            {filteredFailedTasks.map(task => {
              const isEditing = editingTaskId === task.id;

              return (
                <div 
                  key={task.id}
                  className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex-1 flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => toggleTaskMediaType(task)}
                        title="Cliquer pour changer le type"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                          task.mediaType === 'movie'
                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20'
                            : 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20'
                        }`}
                      >
                        {task.mediaType === 'movie' ? <Film size={10} /> : <Tv size={10} />}
                        <span>{task.mediaType === 'movie' ? 'Film' : 'Série'}</span>
                      </button>

                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            className="bg-zinc-950 border border-indigo-500 px-2 py-1 rounded text-xs text-white focus:outline-none flex-1"
                            autoFocus
                          />
                          <button
                            onClick={() => retrySingleTask(task.id, editTitle, task.mediaType)}
                            className="p-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded"
                            title="Sauvegarder et Réessayer"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            onClick={() => setEditingTaskId(null)}
                            className="p-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
                            title="Annuler"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <span className="font-semibold text-zinc-200 truncate" title={task.rawTitle}>
                          {task.rawTitle}
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-red-400/90 italic">
                      {task.error}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {!isEditing && (
                      <button
                        onClick={() => {
                          setEditingTaskId(task.id);
                          setEditTitle(task.rawTitle);
                        }}
                        title="Modifier le nom du titre"
                        className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded flex items-center gap-1 text-[11px] transition-colors"
                      >
                        <Edit2 size={11} />
                        <span>Éditer</span>
                      </button>
                    )}

                    <button
                      onClick={() => retrySingleTask(task.id)}
                      title="Réessayer la recherche TMDB"
                      className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded flex items-center gap-1 text-[11px] font-medium transition-colors"
                    >
                      <RotateCcw size={11} />
                      <span>Réessayer</span>
                    </button>

                    <button
                      onClick={() => deleteSingleTask(task.id)}
                      title="Supprimer ce log d'erreur"
                      className="p-1 bg-zinc-800/80 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
