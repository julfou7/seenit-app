import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Download,
  HardDrive,
  Key,
  Loader2,
  Save,
  Server,
  Wifi
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useToastStore } from '../store/toastStore';
import { testServiceConnection } from '../services/sonarrRadarr';
import { testC411Connection } from '../services/c411';

interface DownloadConfigSectionProps {
  defaultOpen?: boolean;
  hideToggle?: boolean;
}

type TestKey = 'c411' | 'sonarr' | 'radarr' | 'qbittorrent';

export function DownloadConfigSection({ defaultOpen = false, hideToggle = false }: DownloadConfigSectionProps) {
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);
  const fetchDownloads = useLiveDownloadStore(state => state.fetchDownloads);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [testingService, setTestingService] = useState<TestKey | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<TestKey, boolean>>>({});

  const [c411Key, setC411Key] = useState('');
  const [sonarrUrl, setSonarrUrl] = useState('');
  const [sonarrKey, setSonarrKey] = useState('');
  const [radarrUrl, setRadarrUrl] = useState('');
  const [radarrKey, setRadarrKey] = useState('');
  const [qbitUrl, setQbitUrl] = useState('');
  const [qbitUser, setQbitUser] = useState('');
  const [qbitPass, setQbitPass] = useState('');

  useEffect(() => {
    if (!config.isHydrated) return;
    setC411Key(config.c411ApiKey);
    setSonarrUrl(config.sonarrUrl);
    setSonarrKey(config.sonarrApiKey);
    setRadarrUrl(config.radarrUrl);
    setRadarrKey(config.radarrApiKey);
    setQbitUrl(config.qbittorrentUrl);
    setQbitUser(config.qbittorrentUsername);
    setQbitPass(config.qbittorrentPassword);
  }, [
    config.isHydrated,
    config.c411ApiKey,
    config.sonarrUrl,
    config.sonarrApiKey,
    config.radarrUrl,
    config.radarrApiKey,
    config.qbittorrentUrl,
    config.qbittorrentUsername,
    config.qbittorrentPassword
  ]);

  const setTestResult = (key: TestKey, success: boolean) => {
    setTestResults(previous => ({ ...previous, [key]: success }));
  };

  const handleC411Test = async () => {
    const apiKey = c411Key.trim();
    if (!apiKey) {
      showToast('Renseigne la clé API C411.', 'error');
      return;
    }

    setTestingService('c411');
    try {
      const result = await testC411Connection(apiKey);
      setTestResult('c411', result.success);
      showToast(result.message, result.success ? 'success' : 'error');
    } finally {
      setTestingService(null);
    }
  };

  const handleServiceTest = async (service: 'sonarr' | 'radarr' | 'qbittorrent') => {
    const url = service === 'sonarr' ? sonarrUrl : service === 'radarr' ? radarrUrl : qbitUrl;
    const apiKey = service === 'sonarr' ? sonarrKey : service === 'radarr' ? radarrKey : undefined;
    const username = service === 'qbittorrent' ? qbitUser : undefined;
    const password = service === 'qbittorrent' ? qbitPass : undefined;

    if (!url.trim()) {
      showToast(`Renseigne l’URL de ${service}.`, 'error');
      return;
    }

    setTestingService(service);
    try {
      const result = await testServiceConnection(service, url.trim(), apiKey?.trim(), username?.trim(), password?.trim());
      setTestResult(service, result.success);
      showToast(result.message, result.success ? 'success' : 'error');
    } finally {
      setTestingService(null);
    }
  };

  const handleSave = async () => {
    const success = await config.saveConfig({
      c411ApiKey: c411Key,
      sonarrUrl,
      sonarrApiKey: sonarrKey,
      radarrUrl,
      radarrApiKey: radarrKey,
      qbittorrentUrl: qbitUrl,
      qbittorrentUsername: qbitUser,
      qbittorrentPassword: qbitPass
    });

    if (success) {
      showToast('Configuration téléchargements sauvegardée et synchronisée.', 'success');
      void fetchDownloads();
      if (!hideToggle) setIsOpen(false);
    } else {
      showToast(config.saveError || 'Impossible de sauvegarder la configuration.', 'error');
    }
  };

  const native = Capacitor.isNativePlatform();

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Download className="text-blue-400 shrink-0" size={15} />
          <h3 className="font-bold text-xs text-zinc-200 truncate">Téléchargements & clients</h3>
        </div>
        {!hideToggle && (
          <button
            type="button"
            onClick={() => setIsOpen(value => !value)}
            className="text-[10px] font-bold text-blue-300 bg-blue-500/10 px-2.5 py-1.5 rounded-lg border border-blue-500/20"
          >
            {isOpen ? 'Masquer' : 'Configurer'}
          </button>
        )}
      </div>

      {!isOpen ? (
        <p className="text-[11px] text-zinc-500">C411, Sonarr, Radarr et qBittorrent.</p>
      ) : !config.isHydrated ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
          <Loader2 size={16} className="animate-spin text-blue-400" />
          Chargement de la configuration…
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/75 p-3.5 space-y-4">
          <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${
            native
              ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-200'
              : 'bg-amber-500/8 border-amber-500/20 text-amber-200'
          }`}>
            <div className="font-bold flex items-center gap-1.5 mb-1">
              <Wifi size={13} />
              {native ? 'APK Android : accès réseau local direct' : 'Web/PWA : attention aux adresses locales'}
            </div>
            {native
              ? 'Tu peux utiliser directement les IP locales de ton PC/NAS, par exemple 192.168.1.50.'
              : 'Les navigateurs peuvent bloquer l’accès aux IP locales. Pour un NAS/PC local, l’APK Android est le chemin le plus fiable.'}
          </div>

          <ServiceHeader
            icon={<Key size={13} className="text-blue-400" />}
            title="C411"
            testing={testingService === 'c411'}
            result={testResults.c411}
            onTest={() => void handleC411Test()}
          />
          <input
            type="password"
            value={c411Key}
            onChange={event => setC411Key(event.target.value)}
            placeholder="Clé API C411"
            className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
          />

          <div className="h-px bg-zinc-800" />

          <ServiceHeader
            icon={<Server size={13} className="text-cyan-400" />}
            title="Sonarr • séries"
            testing={testingService === 'sonarr'}
            result={testResults.sonarr}
            onTest={() => void handleServiceTest('sonarr')}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={sonarrUrl}
              onChange={event => setSonarrUrl(event.target.value)}
              placeholder="http://192.168.1.50:8989"
              className="rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            />
            <input
              type="password"
              value={sonarrKey}
              onChange={event => setSonarrKey(event.target.value)}
              placeholder="Clé API Sonarr"
              className="rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            />
          </div>

          <div className="h-px bg-zinc-800" />

          <ServiceHeader
            icon={<Server size={13} className="text-amber-400" />}
            title="Radarr • films"
            testing={testingService === 'radarr'}
            result={testResults.radarr}
            onTest={() => void handleServiceTest('radarr')}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={radarrUrl}
              onChange={event => setRadarrUrl(event.target.value)}
              placeholder="http://192.168.1.50:7878"
              className="rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
            />
            <input
              type="password"
              value={radarrKey}
              onChange={event => setRadarrKey(event.target.value)}
              placeholder="Clé API Radarr"
              className="rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
            />
          </div>

          <div className="h-px bg-zinc-800" />

          <ServiceHeader
            icon={<HardDrive size={13} className="text-emerald-400" />}
            title="qBittorrent"
            testing={testingService === 'qbittorrent'}
            result={testResults.qbittorrent}
            onTest={() => void handleServiceTest('qbittorrent')}
          />
          <input
            value={qbitUrl}
            onChange={event => setQbitUrl(event.target.value)}
            placeholder="http://192.168.1.50:8080"
            className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={qbitUser}
              onChange={event => setQbitUser(event.target.value)}
              placeholder="Utilisateur"
              className="rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
            <input
              type="password"
              value={qbitPass}
              onChange={event => setQbitPass(event.target.value)}
              placeholder="Mot de passe"
              className="rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
          </div>

          {config.saveError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-2.5 text-[10px] text-red-300 flex gap-2">
              <AlertCircle size={13} className="shrink-0" />
              {config.saveError}
            </div>
          )}

          <button
            type="button"
            disabled={config.isSaving}
            onClick={() => void handleSave()}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {config.isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {config.isSaving ? 'Enregistrement…' : 'Enregistrer et synchroniser'}
          </button>

          <div className="flex items-center justify-center gap-1.5 text-[9px] text-zinc-500">
            <Cloud size={11} className="text-blue-400" />
            Réglages synchronisés avec ton compte SeenIt
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceHeader({
  icon,
  title,
  testing,
  result,
  onTest
}: {
  icon: React.ReactNode;
  title: string;
  testing: boolean;
  result?: boolean;
  onTest: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-300">
        {icon}
        {title}
        {result === true && <CheckCircle2 size={12} className="text-emerald-400" />}
        {result === false && <AlertCircle size={12} className="text-red-400" />}
      </div>
      <button
        type="button"
        disabled={testing}
        onClick={onTest}
        className="px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-900 text-[9px] font-bold text-zinc-300 flex items-center gap-1 disabled:opacity-50"
      >
        {testing ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
        Tester
      </button>
    </div>
  );
}
