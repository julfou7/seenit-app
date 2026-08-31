import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Key,
  Loader2,
  Save,
  Server,
  RotateCcw,
  Wifi,
  X
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useToastStore } from '../store/toastStore';
import { fetchQualityProfiles, testServiceConnection } from '../services/sonarrRadarr';
import { testC411Connection } from '../services/c411';
import { authenticatedFetch } from '../lib/apiAuth';
import { requestNotificationPermission } from '../lib/firebase';
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
interface PersonalWebhookConfig {
  sonarrUrl: string;
  radarrUrl: string;
  headerName: string;
  secret: string;
}

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
  const [profileErrors, setProfileErrors] = useState<Partial<Record<'sonarr' | 'radarr', string>>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<'c411' | 'sonarr' | 'radarr' | 'qbit' | 'webhook', boolean>>({
    c411: false,
    sonarr: false,
    radarr: false,
    qbit: false,
    webhook: false
  });
  const [isDirty, setIsDirty] = useState(false);
  const [webhookConfig, setWebhookConfig] = useState<PersonalWebhookConfig | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);

  useEffect(() => {
    setIsDirty(false);
  }, [config.scopeUid]);

  useEffect(() => {
    if (!config.isHydrated || isDirty) return;
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
    config.qbittorrentPassword,
    isDirty
  ]);

  useEffect(() => {
    if (!config.isHydrated) return;
    let cancelled = false;

    const load = async () => {
      const requests: Promise<void>[] = [];
      if (config.sonarrUrl && config.sonarrApiKey) requests.push((async () => {
        try {
          const profiles = await fetchQualityProfiles('sonarr', config.sonarrUrl, config.sonarrApiKey);
          if (!cancelled) {
            setSonarrProfiles(profiles);
            setProfileErrors(previous => ({ ...previous, sonarr: undefined }));
          }
        } catch (error: any) {
          if (!cancelled) setProfileErrors(previous => ({ ...previous, sonarr: error?.message || 'Profils Sonarr indisponibles.' }));
        }
      })());
      if (config.radarrUrl && config.radarrApiKey) requests.push((async () => {
        try {
          const profiles = await fetchQualityProfiles('radarr', config.radarrUrl, config.radarrApiKey);
          if (!cancelled) {
            setRadarrProfiles(profiles);
            setProfileErrors(previous => ({ ...previous, radarr: undefined }));
          }
        } catch (error: any) {
          if (!cancelled) setProfileErrors(previous => ({ ...previous, radarr: error?.message || 'Profils Radarr indisponibles.' }));
        }
      })());
      await Promise.all(requests);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [config.isHydrated, config.sonarrUrl, config.sonarrApiKey, config.radarrUrl, config.radarrApiKey]);

  const loadWebhookConfig = async (rotate = false) => {
    setLoadingWebhooks(true);
    setWebhookError(null);
    try {
      const response = await authenticatedFetch(rotate ? '/api/webhooks/config/rotate' : '/api/webhooks/config', {
        method: rotate ? 'POST' : 'GET'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Webhooks personnels indisponibles.');
      setWebhookConfig(data as PersonalWebhookConfig);
      if (rotate) showToast('Secret webhook renouvelé. Mets à jour Sonarr et Radarr.', 'success');
    } catch (error: any) {
      setWebhookError(error?.message || 'Webhooks personnels indisponibles.');
    } finally {
      setLoadingWebhooks(false);
    }
  };

  useEffect(() => {
    if (!config.isHydrated || !isOpen) return;
    void loadWebhookConfig(false);
  }, [config.isHydrated, config.scopeUid, isOpen]);

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
      setProfileErrors(previous => ({ ...previous, [service]: undefined }));
    } catch (error: any) {
      const message = error?.message || `Impossible de charger les profils ${service}.`;
      setProfileErrors(previous => ({ ...previous, [service]: message }));
      showToast(message, 'error');
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
      setIsDirty(false);
      showToast('Configuration téléchargements sauvegardée et synchronisée.', 'success');
      void fetchDownloads();
      if (!hideToggle) setIsOpen(false);
    } else {
      showToast(config.saveError || 'Impossible de sauvegarder la configuration.', 'error');
    }
  };

  const copyWebhookValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copié.`, 'success');
    } catch {
      showToast(`Impossible de copier ${label.toLowerCase()}.`, 'error');
    }
  };

  const native = Capacitor.isNativePlatform();

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Download className="text-[#E5A93D] shrink-0" size={15} />
          <h3 className="font-bold text-xs text-zinc-200 truncate">Téléchargements & clients</h3>
        </div>
        {!hideToggle && (
          <button
            type="button"
            onClick={() => setIsOpen(value => !value)}
            className="min-h-11 text-xs font-bold text-[#E5A93D] bg-[#E5A93D]/10 px-3 rounded-lg border border-[#E5A93D]/20"
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
          <div className={`rounded-xl border p-3 text-xs leading-relaxed ${
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
          <ConfigField
            label="Clé API C411"
            value={c411Key}
            onChange={value => { setC411Key(value); setIsDirty(true); }}
            secret
            visible={visibleSecrets.c411}
            onToggleVisibility={() => setVisibleSecrets(previous => ({ ...previous, c411: !previous.c411 }))}
          />

          <ServiceHeader
            icon={<Server size={13} className="text-cyan-400" />}
            title="Sonarr • séries"
            testing={testingService === 'sonarr'}
            result={testResults.sonarr}
            onTest={() => void handleServiceTest('sonarr')}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ConfigField
              label="URL Sonarr"
              value={sonarrUrl}
              onChange={value => { setSonarrUrl(value); setIsDirty(true); }}
              placeholder="http://192.168.1.50:8989"
            />
            <ConfigField
              label="Clé API Sonarr"
              value={sonarrKey}
              onChange={value => { setSonarrKey(value); setIsDirty(true); }}
              secret
              visible={visibleSecrets.sonarr}
              onToggleVisibility={() => setVisibleSecrets(previous => ({ ...previous, sonarr: !previous.sonarr }))}
            />
          </div>
          <QualityProfileMapping
            serviceLabel="Sonarr"
            profiles={sonarrProfiles}
            loading={loadingProfiles === 'sonarr'}
            profile1080pId={sonarr1080pProfileId}
            profile4kId={sonarr4kProfileId}
            on1080pChange={value => { setSonarr1080pProfileId(value); setIsDirty(true); }}
            on4kChange={value => { setSonarr4kProfileId(value); setIsDirty(true); }}
            error={profileErrors.sonarr}
          />

          <ServiceHeader
            icon={<Server size={13} className="text-amber-400" />}
            title="Radarr • films"
            testing={testingService === 'radarr'}
            result={testResults.radarr}
            onTest={() => void handleServiceTest('radarr')}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ConfigField
              label="URL Radarr"
              value={radarrUrl}
              onChange={value => { setRadarrUrl(value); setIsDirty(true); }}
              placeholder="http://192.168.1.50:7878"
            />
            <ConfigField
              label="Clé API Radarr"
              value={radarrKey}
              onChange={value => { setRadarrKey(value); setIsDirty(true); }}
              secret
              visible={visibleSecrets.radarr}
              onToggleVisibility={() => setVisibleSecrets(previous => ({ ...previous, radarr: !previous.radarr }))}
            />
          </div>
          <QualityProfileMapping
            serviceLabel="Radarr"
            profiles={radarrProfiles}
            loading={loadingProfiles === 'radarr'}
            profile1080pId={radarr1080pProfileId}
            profile4kId={radarr4kProfileId}
            on1080pChange={value => { setRadarr1080pProfileId(value); setIsDirty(true); }}
            on4kChange={value => { setRadarr4kProfileId(value); setIsDirty(true); }}
            error={profileErrors.radarr}
          />

          <ServiceHeader
            icon={<HardDrive size={13} className="text-emerald-400" />}
            title="qBittorrent"
            testing={testingService === 'qbittorrent'}
            result={testResults.qbittorrent}
            onTest={() => void handleServiceTest('qbittorrent')}
          />
          <ConfigField
            label="URL qBittorrent"
            value={qbitUrl}
            onChange={value => { setQbitUrl(value); setIsDirty(true); }}
            placeholder="http://192.168.1.50:8080"
          />
          <div className="grid grid-cols-2 gap-2">
            <ConfigField
              label="Utilisateur qBittorrent"
              value={qbitUser}
              onChange={value => { setQbitUser(value); setIsDirty(true); }}
            />
            <ConfigField
              label="Mot de passe qBittorrent"
              value={qbitPass}
              onChange={value => { setQbitPass(value); setIsDirty(true); }}
              secret
              visible={visibleSecrets.qbit}
              onToggleVisibility={() => setVisibleSecrets(previous => ({ ...previous, qbit: !previous.qbit }))}
            />
          </div>

          <section className="rounded-2xl border border-[#E5A93D]/20 bg-[#E5A93D]/[0.06] p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-white">Notifications personnelles</h4>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Chaque appareil PWA ou APK possède son propre token. Ces webhooks ne notifient que les appareils connectés à ton compte.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingWebhooks}
                onClick={() => void loadWebhookConfig(true)}
                className="min-h-11 min-w-11 rounded-xl border border-white/10 bg-zinc-900 text-zinc-300 flex items-center justify-center disabled:opacity-50"
                aria-label="Renouveler le secret des webhooks personnels"
                title="Renouveler le secret"
              >
                {loadingWebhooks ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              </button>
            </div>

            {webhookConfig ? (
              <div className="space-y-2">
                <WebhookValue label="URL Sonarr" value={webhookConfig.sonarrUrl} onCopy={copyWebhookValue} />
                <WebhookValue label="URL Radarr" value={webhookConfig.radarrUrl} onCopy={copyWebhookValue} />
                <WebhookValue
                  label={`Secret d’en-tête (${webhookConfig.headerName})`}
                  value={webhookConfig.secret}
                  secret={!visibleSecrets.webhook}
                  onCopy={copyWebhookValue}
                  onToggle={() => setVisibleSecrets(previous => ({ ...previous, webhook: !previous.webhook }))}
                />
                <p className="text-xs leading-relaxed text-zinc-400">
                  Dans Sonarr et Radarr, ajoute l’en-tête <code className="text-[#E5A93D]">{webhookConfig.headerName}</code>. Le secret n’est jamais placé dans l’URL ni écrit dans les logs.
                </p>
              </div>
            ) : webhookError ? (
              <p className="text-xs text-red-300" role="alert">{webhookError}</p>
            ) : (
              <p className="text-xs text-zinc-400">Chargement des webhooks personnels…</p>
            )}

            <button
              type="button"
              onClick={async () => {
                const token = await requestNotificationPermission();
                showToast(token ? 'Cet appareil recevra les notifications.' : 'Autorisation ou token de notification indisponible.', token ? 'success' : 'error');
              }}
              className="w-full min-h-11 rounded-xl border border-[#E5A93D]/30 bg-zinc-950 text-sm font-bold text-[#E5A93D] flex items-center justify-center gap-2"
            >
              <Bell size={16} />
              Activer les notifications sur cet appareil
            </button>
          </section>

          {config.saveError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-300 flex gap-2">
              <AlertCircle size={13} className="shrink-0" />
              {config.saveError}
            </div>
          )}

          <button
            type="button"
            disabled={config.isSaving}
            onClick={() => void handleSave()}
            className="w-full min-h-11 rounded-xl bg-[#E5A93D] hover:bg-[#f0b84c] text-black text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {config.isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {config.isSaving ? 'Enregistrement…' : 'Enregistrer et synchroniser'}
          </button>

          <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-500">
            <Cloud size={11} className="text-blue-400" />
            Réglages synchronisés avec ton compte SeenIt
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">
            Sécurité : les identifiants clients sont stockés dans le document Firestore privé de ton UID et transmis au backend uniquement pour les appels demandés. Toute session connectée à ton compte peut les utiliser ; protège donc aussi ton compte Google.
          </p>
        </div>
      )}
    </div>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
  visible = false,
  onToggleVisibility
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
  visible?: boolean;
  onToggleVisibility?: () => void;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="block text-xs font-bold text-zinc-300">{label}</span>
      <span className="relative block">
        <input
          type={secret && !visible ? 'password' : 'text'}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full min-h-11 rounded-xl bg-zinc-900 border border-zinc-700 px-3 text-sm text-white outline-none focus:border-[#E5A93D] ${secret ? 'pr-12' : ''}`}
        />
        {secret && onToggleVisibility && (
          <button
            type="button"
            onClick={onToggleVisibility}
            className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-zinc-400 hover:text-white"
            aria-label={visible ? `Masquer ${label}` : `Afficher ${label}`}
          >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </span>
    </label>
  );
}

function WebhookValue({
  label,
  value,
  secret = false,
  onCopy,
  onToggle
}: {
  label: string;
  value: string;
  secret?: boolean;
  onCopy: (value: string, label: string) => Promise<void>;
  onToggle?: () => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-bold text-zinc-300">{label}</span>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-xs text-zinc-300">
          {secret ? '••••••••••••••••••••••••' : value}
        </code>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="w-11 h-11 shrink-0 rounded-xl border border-white/10 bg-zinc-900 text-zinc-300 flex items-center justify-center"
            aria-label={secret ? `Afficher ${label}` : `Masquer ${label}`}
          >
            {secret ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => void onCopy(value, label)}
          className="w-11 h-11 shrink-0 rounded-xl border border-white/10 bg-zinc-900 text-zinc-300 flex items-center justify-center"
          aria-label={`Copier ${label}`}
        >
          <Copy size={16} />
        </button>
      </div>
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
  on4kChange,
  error
}: {
  serviceLabel: string;
  profiles: QualityProfile[];
  loading: boolean;
  profile1080pId: number | null;
  profile4kId: number | null;
  on1080pChange: (value: number | null) => void;
  on4kChange: (value: number | null) => void;
  error?: string;
}) {
  if (loading) {
    return (
      <div className="text-xs text-zinc-500 flex items-center gap-1.5">
        <Loader2 size={11} className="animate-spin" />
        Chargement des profils {serviceLabel}…
      </div>
    );
  }

  if (!profiles.length) {
    return (
      <p className={`text-xs ${error ? 'text-red-300' : 'text-zinc-500'}`} role={error ? 'alert' : undefined}>
        {error || `Profils qualité : détection automatique. Teste la connexion pour charger les profils ${serviceLabel} disponibles.`}
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 p-2.5 space-y-2">
      <div>
        <p className="text-xs font-bold text-zinc-300">Profils qualité SeenIt → {serviceLabel}</p>
        <p className="text-xs text-zinc-500 mt-0.5">
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
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const pickerDialogRef = useRef<HTMLDivElement>(null);
  const autoProfile = resolveAutoQualityProfile(profiles, preference);
  const selectedProfile = value != null ? profiles.find(profile => profile.id === value) : null;
  const displayValue = selectedProfile?.name
    || (value != null ? `Profil #${value}` : `Auto → ${autoProfile?.name || 'détection'}`);

  useEffect(() => {
    if (!isPickerOpen) return;
    pickerDialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPickerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      pickerButtonRef.current?.focus();
    };
  }, [isPickerOpen]);

  return (
    <div className="space-y-1">
      <span className="block text-xs font-black uppercase text-zinc-500">{label}</span>
      <button
        ref={pickerButtonRef}
        type="button"
        onClick={() => setIsPickerOpen(true)}
        className="w-full min-h-11 rounded-lg bg-zinc-950 border border-zinc-700 px-2.5 py-2 text-left text-xs text-zinc-200 outline-none flex items-center justify-between gap-2"
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
            ref={pickerDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Choisir le profil ${label}`}
            tabIndex={-1}
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
                className="w-11 h-11 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center"
                aria-label={`Fermer le choix du profil ${label}`}
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
                    ? 'border-[#E5A93D]/40 bg-[#E5A93D]/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/70 text-zinc-200'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-bold">Auto</span>
                  <span className="block text-[10px] mt-0.5 text-zinc-400 truncate">
                    {autoProfile ? `Utilisera ${autoProfile.name}` : 'Détection au moment du téléchargement'}
                  </span>
                </span>
                {value == null && <Check size={15} className="shrink-0 text-[#E5A93D]" />}
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
                        ? 'border-[#E5A93D]/40 bg-[#E5A93D]/10 text-white'
                        : 'border-zinc-800 bg-zinc-950/70 text-zinc-200'
                    }`}
                  >
                    <span className="min-w-0 text-xs font-semibold truncate">{profile.name}</span>
                    {selected && <Check size={15} className="shrink-0 text-[#E5A93D]" />}
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
        className="min-h-11 px-3 rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-bold text-zinc-300 flex items-center gap-1.5 disabled:opacity-50"
      >
        {testing ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
        Tester
      </button>
    </div>
  );
}
