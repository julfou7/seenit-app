import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { authenticatedFetch } from '../lib/apiAuth';
import { SeenItLogo } from '../components/SeenItLogo';

interface Device { profile: string; deviceName: string; state: string }
export function TvPairingPage({ user }: { user: User }) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('tvLink') || '', code = params.get('code') || '';
  const valid = /^[a-f0-9]{48}$/.test(id) && /^[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}$/.test(code);
  const [device, setDevice] = useState<Device | null>(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDevice(null); setState(valid ? 'loading' : 'error');
    if (!valid) { setMessage('Ce code de connexion est invalide. Demande un nouveau QR code sur la TV.'); return; }
    void authenticatedFetch(`/api/tv/links/${id}/inspect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: controller.signal }, user.uid)
      .then(async response => { if (!response.ok) throw new Error('Ce code a expiré ou a déjà été utilisé par un autre compte.'); return response.json() as Promise<Device>; })
      .then(value => { if (!controller.signal.aborted) { setDevice(value); setState(value.state === 'active' ? 'done' : 'ready'); } })
      .catch(error => { if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : 'Connexion indisponible.'); setState('error'); } });
    return () => controller.abort();
  }, [id, code, valid, user.uid]);
  async function approve() {
    if (state !== 'ready') return;
    setState('approving');
    try {
      const response = await authenticatedFetch(`/api/tv/links/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }, user.uid);
      if (!response.ok) throw new Error('L’association a échoué. Demande un nouveau code sur la TV.');
      setState('done');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Connexion indisponible.'); setState('error'); }
  }
  return <main className="min-h-[100dvh] bg-zinc-950 text-white p-6 flex flex-col items-center justify-center">
    <section className="w-full max-w-md space-y-6" aria-label="Connecter SeenIt TV">
      <SeenItLogo />
      <h1 className="text-2xl font-bold">{state === 'done' ? 'La TV est connectée' : 'Connecter SeenIt TV'}</h1>
      <p className="text-zinc-300">Compte : {user.displayName || user.email || 'Ton compte SeenIt'}</p>
      {device && <div className="rounded-2xl bg-white/5 p-4 space-y-2"><p>{device.deviceName}</p><p>Profil : {device.profile}</p><p className="font-mono text-xl text-[#E5A93D]">{code.toUpperCase()}</p></div>}
      {state === 'loading' && <p role="status">Vérification du code…</p>}
      {(state === 'ready' || state === 'approving') && <><p className="text-zinc-400">Confirme seulement si ce code est affiché sur ta TV. Les autres profils resteront locaux.</p><button type="button" disabled={state === 'approving'} onClick={() => { void approve(); }} className="w-full min-h-12 rounded-full bg-[#E5A93D] text-black font-bold px-5 py-3">{state === 'approving' ? 'Association…' : 'Associer la TV'}</button></>}
      {state === 'error' && <p role="alert">{message}</p>}
      {state === 'done' && <p role="status">Tu peux revenir sur ta TV. Aucun visionnage n’a été modifié.</p>}
      <a href="/" className="inline-flex min-h-12 items-center text-zinc-300 underline">Revenir à SeenIt</a>
    </section>
  </main>;
}
