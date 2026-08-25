import React, { useState } from 'react';
import { Download, Server, Key, Globe, Check, AlertCircle, Save, Sliders, HardDrive } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';

export function DownloadConfigSection() {
  const { showToast } = useToastStore();
  const config = useDownloadConfigStore();
  const [isOpen, setIsOpen] = useState(false);

  const [c411Key, setC411Key] = useState(config.c411ApiKey);
  const [sonarrUrl, setSonarrUrl] = useState(config.sonarrUrl);
  const [sonarrKey, setSonarrKey] = useState(config.sonarrApiKey);
  const [radarrUrl, setRadarrUrl] = useState(config.radarrUrl);
  const [radarrKey, setRadarrKey] = useState(config.radarrApiKey);
  const [qbitUrl, setQbitUrl] = useState(config.qbittorrentUrl);
  const [qbitUser, setQbitUser] = useState(config.qbittorrentUsername);
  const [qbitPass, setQbitPass] = useState(config.qbittorrentPassword);

  const handleSave = () => {
    config.setConfig({
      c411ApiKey: c411Key.trim(),
      sonarrUrl: sonarrUrl.trim(),
      sonarrApiKey: sonarrKey.trim(),
      radarrUrl: radarrUrl.trim(),
      radarrApiKey: radarrKey.trim(),
      qbittorrentUrl: qbitUrl.trim(),
      qbittorrentUsername: qbitUser.trim(),
      qbittorrentPassword: qbitPass.trim(),
    });
    showToast('Configuration des téléchargements sauvegardée !', 'success');
    setIsOpen(false);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Download className="text-blue-400" size={14} />
          <h3 className="font-bold text-xs text-zinc-200">Téléchargement & Tracker (C411)</h3>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-[11px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 cursor-pointer transition-colors"
        >
          {isOpen ? 'Masquer' : 'Configurer'}
        </button>
      </div>

      <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed font-medium">
        Recherche automatique sur le tracker C411 et envoi vers Sonarr, Radarr ou qBittorrent lorsque le média n'est pas en streaming.
      </p>

      {isOpen && (
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-3.5 mt-2 animate-in fade-in duration-150">
          {/* C411 API Key */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-300 mb-1 flex items-center gap-1.5">
              <Key size={12} className="text-blue-400" />
              Clé API C411
            </label>
            <input
              type="password"
              value={c411Key}
              onChange={(e) => setC411Key(e.target.value)}
              placeholder="Clé API de votre compte C411"
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="h-px bg-zinc-800/60" />

          {/* Sonarr (Séries) */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
              <Server size={12} className="text-cyan-400" />
              Sonarr (Séries) - Optionnel
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={sonarrUrl}
                onChange={(e) => setSonarrUrl(e.target.value)}
                placeholder="http://192.168.1.50:8989"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
              />
              <input
                type="password"
                value={sonarrKey}
                onChange={(e) => setSonarrKey(e.target.value)}
                placeholder="Clé API Sonarr"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Radarr (Films) */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
              <Server size={12} className="text-amber-400" />
              Radarr (Films) - Optionnel
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={radarrUrl}
                onChange={(e) => setRadarrUrl(e.target.value)}
                placeholder="http://192.168.1.50:7878"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
              />
              <input
                type="password"
                value={radarrKey}
                onChange={(e) => setRadarrKey(e.target.value)}
                placeholder="Clé API Radarr"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* qBittorrent */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
              <HardDrive size={12} className="text-emerald-400" />
              qBittorrent Web UI - Optionnel
            </span>
            <div className="space-y-2">
              <input
                type="text"
                value={qbitUrl}
                onChange={(e) => setQbitUrl(e.target.value)}
                placeholder="http://192.168.1.50:8080"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={qbitUser}
                  onChange={(e) => setQbitUser(e.target.value)}
                  placeholder="Nom d'utilisateur"
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="password"
                  value={qbitPass}
                  onChange={(e) => setQbitPass(e.target.value)}
                  placeholder="Mot de passe"
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            className="w-full mt-2 py-2 px-4 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
          >
            <Save size={14} />
            Enregistrer la configuration
          </button>
        </div>
      )}
    </div>
  );
}
