import React, { useState, useEffect } from 'react';
import { Download, Server, Key, Globe, Check, AlertCircle, Save, Sliders, HardDrive, Loader2, Wifi, Cloud } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { testServiceConnection } from '../services/sonarrRadarr';

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

  // Synchroniser les champs du formulaire si la config du store est mise à jour depuis le cloud
  useEffect(() => {
    setC411Key(config.c411ApiKey);
    setSonarrUrl(config.sonarrUrl);
    setSonarrKey(config.sonarrApiKey);
    setRadarrUrl(config.radarrUrl);
    setRadarrKey(config.radarrApiKey);
    setQbitUrl(config.qbittorrentUrl);
    setQbitUser(config.qbittorrentUsername);
    setQbitPass(config.qbittorrentPassword);
  }, [
    config.c411ApiKey,
    config.sonarrUrl,
    config.sonarrApiKey,
    config.radarrUrl,
    config.radarrApiKey,
    config.qbittorrentUrl,
    config.qbittorrentUsername,
    config.qbittorrentPassword
  ]);

  const [testingService, setTestingService] = useState<string | null>(null);

  const handleTest = async (service: 'sonarr' | 'radarr' | 'qbittorrent') => {
    setTestingService(service);
    let url = service === 'sonarr' ? sonarrUrl : service === 'radarr' ? radarrUrl : qbitUrl;
    let apiKey = service === 'sonarr' ? sonarrKey : service === 'radarr' ? radarrKey : undefined;
    let username = service === 'qbittorrent' ? qbitUser : undefined;
    let password = service === 'qbittorrent' ? qbitPass : undefined;

    if (!url) {
      showToast(`Veuillez renseigner l'URL de ${service}`, 'error');
      setTestingService(null);
      return;
    }

    const res = await testServiceConnection(service, url, apiKey, username, password);
    setTestingService(null);
    if (res.success) {
      showToast(res.message, 'success');
    } else {
      showToast(res.message, 'error');
    }
  };

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
          <h3 className="font-bold text-xs text-zinc-200">Téléchargement & Tracker (C411 / Sonarr)</h3>
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
        Recherche sur C411 et envoi automatique à Sonarr, Radarr ou qBittorrent sur votre PC/NAS local.
      </p>

      {isOpen && (
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-3.5 mt-2 animate-in fade-in duration-150">
          {/* Info intro */}
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[11px] text-blue-300 space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-blue-200">
              <Sliders size={13} />
              Comment connecter Sonarr / Radarr depuis votre téléphone :
            </p>
            <p className="text-zinc-400 text-[10px] leading-relaxed">
              • Utilisez l'<strong>adresse IP locale de votre PC</strong> (ex: <code>http://192.168.1.50:8989</code>) et non <code>localhost</code>.<br />
              • Votre téléphone et votre PC doivent être sur le <strong>même réseau Wi-Fi</strong>.<br />
              • La clé API se trouve dans Sonarr : <em>Settings → General → Security → API Key</em>.
            </p>
          </div>

          {/* C411 API Key */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-300 mb-1 flex items-center gap-1.5">
              <Key size={12} className="text-blue-400" />
              Clé API C411 (Tracker)
            </label>
            <input
              type="password"
              value={c411Key}
              onChange={(e) => setC411Key(e.target.value)}
              placeholder="Clé API de votre compte C411"
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              Trouvable dans votre profil C411. Une clé par défaut est déjà configurée.
            </p>
          </div>

          <div className="h-px bg-zinc-800/60" />

          {/* Sonarr (Séries) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                <Server size={12} className="text-cyan-400" />
                Sonarr (Séries TV)
              </span>
              <button
                type="button"
                onClick={() => handleTest('sonarr')}
                disabled={testingService === 'sonarr'}
                className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {testingService === 'sonarr' ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
                Tester la connexion
              </button>
            </div>
            <p className="text-[10px] text-zinc-400">
              IP locale de votre PC + Clé API (ex: <code>http://192.168.1.XX:8989</code>)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                <Server size={12} className="text-amber-400" />
                Radarr (Films)
              </span>
              <button
                type="button"
                onClick={() => handleTest('radarr')}
                disabled={testingService === 'radarr'}
                className="text-[10px] font-bold text-amber-400 hover:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {testingService === 'radarr' ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
                Tester la connexion
              </button>
            </div>
            <p className="text-[10px] text-zinc-400">
              IP locale de votre PC + Clé API (ex: <code>http://192.168.1.XX:7878</code>)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                <HardDrive size={12} className="text-emerald-400" />
                qBittorrent (Web UI)
              </span>
              <button
                type="button"
                onClick={() => handleTest('qbittorrent')}
                disabled={testingService === 'qbittorrent'}
                className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {testingService === 'qbittorrent' ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
                Tester la connexion
              </button>
            </div>
            <p className="text-[10px] text-zinc-400">
              URL de l'interface Web qBittorrent (ex: <code>http://192.168.1.50:8080</code>)
            </p>
            <div className="space-y-2 pt-0.5">
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
                  placeholder="Utilisateur (ex: admin)"
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
            className="w-full mt-2 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-98 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md shadow-blue-500/20"
          >
            <Save size={14} />
            <span>Enregistrer et synchroniser avec mon compte</span>
          </button>
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-zinc-500 pt-1">
            <Cloud size={11} className="text-blue-400" />
            <span>Vos paramètres sont automatiquement synchronisés sur tous vos appareils (PC & Mobile)</span>
          </div>
        </div>
      )}
    </div>
  );
}
