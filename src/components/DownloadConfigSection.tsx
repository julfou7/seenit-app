import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Download,
  HardDrive,
  Key,
  Loader2,
  Save,
  Server,
  Wifi,
  X
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useToastStore } from '../store/toastStore';
import { fetchQualityProfiles, testServiceConnection } from '../services/sonarrRadarr';
import { testC411Connection } from '../services/c411';
import {
  resolveAutoQualityProfile,
  type DownloadQualityPreference,
  type QualityProfileSummary
} from '../features/downloads/qualityProfileSelection';

interface DownloadConfigSectionProps {
  defaultOpen?: boolean;
  hideToggle?: boolean;
}

type TestKey = 'c411' | 'sonarr' | 'radarr' | 'qbittorrent';
type QualityProfile = QualityProfileSummary;

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
  const [sonarr1080pProfileId, setSonarr1080pProfileId] = useState<number | null>(null);
  const [sonarr4kProfileId, setSonarr4kProfileId] = useState<number | null>(null);
  const [radarrUrl, setRadarrUrl] = useState('');
  const [radarrKey, setRadarrKey] = useState('');
  const [radarr1080pProfileId, setRadarr1080pProfileId] = useState<number | null>(null);
  const [radarr4kProfileId, setRadarr4kProfileId] = useState<number | null>(null);
  const [qbitUrl, setQbitUrl] = useState('');
  const [qbitUser, setQbitUser] = useState('');
  const [qbitPass, setQbitPass] = useState('');
  const [sonarrProfiles, setSonarrProfiles] = useState<QualityProfile[]>([]);
  const [radarrProfiles, setRadarrProfiles] = useState<QualityProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState<'sonarr' | 'radarr' | null>(null);

  useEffect(() => {
    if (!config.isHydrated) return;
    setC411Key(config.c411ApiKey);
    setSonarrUrl(config.sonarrUrl);
    setSonarrKey(config.sonarrApiKey);
    setSonarr1080pProfileId(config.sonarr1080pProfileId ?? null);
    setSonarr4kProfileId(config.sonarr4kProfileId ?? null);
    setRadarrUrl(config.radarrUrl);
    setRadarrKey(config.radarrApiKey);
    setRadarr1080pProfileId(config.radarr1080pProfileId ?? null);
    setRadarr4kProfileId(config.radarr4kProfileId ?? null);
    setQbitUrl(config.qbittorrentUrl);
    setQbitUser(config.qbittorrentUsername);
    setQbitPass(config.qbittorrentPassword);
  }, [
    config.isHydrated,
    config.c411ApiKey,
    config.sonarrUrl,
    config.sonarrApiKey,
    config.sonarr1080pProfileId,
    config.sonarr4kProfileId,
    config.radarrUrl,
    config.radarrApiKey,
    config.radarr1080pProfileId,
    config.radarr4kProfileId,
    config.qbittorrentUrl,
    config.qbittorrentUsername,
    config.qbittorrentPassword
  ]);

  useEffect(() => {
    if (!config.isHydrated) return;
    let cancelled = false;

    const load = async () => {
      if (config.sonarrUrl && config.sonarrApiKey) {
        const profiles = await fetchQualityProfiles('sonarr', config.sonarrUrl, config.sonarrApiKey);
        if (!cancelled) setSonarrProfiles(profiles);
      }
      if (config.radarrUrl && config.radarrApiKey) {
        const profiles = await fetchQualityProfiles('radarr', config.radarrUrl, config.radarrApiKey);
        if (!cancelled) setRadarrProfiles(profiles);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [config.isHydrated, config.sonarrUrl, config.sonarrApiKey, config.radarrUrl, config.radarrApiKey]);

  const setTestResult = (key: TestKey, success: boolean) => {
    setTestResults(previous => ({ ...previous, [key]: success }));
  };

  const loadProfilesFor = async (service: 'sonarr' | 'radarr', url: string, apiKey: string) => {
    if (!url.trim() || !apiKey.trim()) return;
    setLoadingProfiles(service);
    try {
      const profiles = await fetchQualityProfiles(service, url.trim(), apiKey.trim());
      if (service === 'sonarr') setSonarrProfiles(profiles);
      else setRadarrProfiles(profiles);
    } finally {
      setLoadingProfiles(null);
    }
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
      if (result.success && (service === 'sonarr' || service === 'radarr') && apiKey) {
        await loadProfilesFor(service, url, apiKey);
      }
    } finally {
      setTestingService(null);
    }
  };

  const handleSave = async () => {
    const success = await config.saveConfig({
      c411ApiKey: c411Key,
      sonarrUrl,
      sonarrApiKey: sonarrKey,
      sonarr1080pProfileId,
      sonarr4kProfileId,
      radarrUrl,
      radarrApiKey: radarrKey,
      radarr1080pProfileId,
      radarr4kProfileId,
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
          <QualityProfileMapping
            serviceLabel="Sonarr"
            profiles={sonarrProfiles}
            loading={loadingProfiles === 'sonarr'}
            profile1080pId={sonarr1080pProfileId}
            profile4kId={sonarr4kProfileId}
            on1080pChange={setSonarr1080pProfileId}
            on4kChange={setSonarr4kProfileId}
          />

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
          <QualityProfileMapping
            serviceLabel="Radarr"
            profiles={radarrProfiles}
            loading={loadingProfiles === 'radarr'}
            profile1080pId={radarr1080pProfileId}
            profile4kId={radarr4kProfileId}
            on1080pChange={setRadarr1080pProfileId}
            on4kChange={setRadarr4kProfileId}
          />

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

function QualityProfileMapping({
  serviceLabel,
  profiles,
  loading,
  profile1080pId,
  profile4kId,
  on1080pChange,
  on4kChange
}: {
  serviceLabel: string;
  profiles: QualityProfile[];
  loading: boolean;
  profile1080pId: number | null;
  profile4kId: number | null;
  on1080pChange: (value: number | null) => void;
  on4kChange: (value: number | null) => void;
}) {
  if (loading) {
    return (
      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
        <Loader2 size={11} className="animate-spin" />
        Chargement des profils {serviceLabel}…
      </div>
    );
  }

  if (!profiles.length) {
    return (
      <p className="text-[10px] text-zinc-500">
        Profils qualité : détection automatique. Teste la connexion pour charger les profils {serviceLabel} disponibles.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 p-2.5 space-y-2">
      <div>
        <p className="text-[10px] font-bold text-zinc-300">Profils qualité SeenIt → {serviceLabel}</p>
        <p className="text-[9px] text-zinc-500 mt-0.5">
          “Auto” choisit le profil le plus spécifique disponible et affiche celui qui sera réellement utilisé.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ProfilePicker
          label="1080p"
          preference="1080p"
          profiles={profiles}
          value={profile1080pId}
          onChange={on1080pChange}
        />
        <ProfilePicker
          label="4K"
          preference="4k"
          profiles={profiles}
          value={profile4kId}
          onChange={on4kChange}
        />
      </div>
    </div>
  );
}

function ProfilePicker({
  label,
  preference,
  profiles,
  value,
  onChange
}: {
  label: string;
  preference: DownloadQualityPreference;
  profiles: QualityProfile[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const autoProfile = resolveAutoQualityProfile(profiles, preference);
  const selectedProfile = value != null ? profiles.find(profile => profile.id === value) : null;
  const displayValue = selectedProfile?.name
    || (value != null ? `Profil #${value}` : `Auto → ${autoProfile?.name || 'détection'}`);

  return (
    <div className="space-y-1">
      <span className="block text-[9px] font-black uppercase text-zinc-500">{label}</span>
      <button
        type="button"
        onClick={() => setIsPickerOpen(true)}
        className="w-full min-h-10 rounded-lg bg-zinc-950 border border-zinc-700 px-2.5 py-2 text-left text-[10px] text-zinc-200 outline-none flex items-center justify-between gap-2"
        aria-haspopup="dialog"
        aria-expanded={isPickerOpen}
      >
        <span className="min-w-0 truncate font-semibold">{displayValue}</span>
        <ChevronDown size={13} className="shrink-0 text-zinc-500" />
      </button>

      {isPickerOpen && (
        <div
          className="fixed inset-0 z-[320] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
          onClick={() => setIsPickerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Choisir le profil ${label}`}
            className="w-full max-w-sm max-h-[76vh] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col"
            onClick={event => event.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between gap-3 px-3.5 py-3 border-b border-zinc-800">
              <div>
                <p className="text-sm font-extrabold text-white">Profil {label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Sélection SeenIt pour Sonarr/Radarr</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center"
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setIsPickerOpen(false);
                }}
                className={`w-full rounded-xl border px-3 py-2.5 text-left flex items-center justify-between gap-3 ${
                  value == null
                    ? 'border-blue-500/40 bg-blue-500/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/70 text-zinc-200'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-bold">Auto</span>
                  <span className="block text-[10px] mt-0.5 text-zinc-400 truncate">
                    {autoProfile ? `Utilisera ${autoProfile.name}` : 'Détection au moment du téléchargement'}
                  </span>
                </span>
                {value == null && <Check size={15} className="shrink-0 text-blue-400" />}
              </button>

              {profiles.map(profile => {
                const selected = value === profile.id;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => {
                      onChange(profile.id);
                      setIsPickerOpen(false);
                    }}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left flex items-center justify-between gap-3 ${
                      selected
                        ? 'border-blue-500/40 bg-blue-500/10 text-white'
                        : 'border-zinc-800 bg-zinc-950/70 text-zinc-200'
                    }`}
                  >
                    <span className="min-w-0 text-xs font-semibold truncate">{profile.name}</span>
                    {selected && <Check size={15} className="shrink-0 text-blue-400" />}
                  </button>
                );
              })}
            </div>
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
