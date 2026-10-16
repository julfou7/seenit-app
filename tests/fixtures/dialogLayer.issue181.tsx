import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogLayer } from '../../src/components/ui/DialogLayer';
import { closeTopDialog, closeTabSubview } from '../../src/features/navigation/dialogStack';

function Harness() {
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [child, setChild] = useState(false);
  const [locked, setLocked] = useState(false);
  const [external, setExternal] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [originPerson, setOriginPerson] = useState(false);
  const [tab, setTab] = useState('profile');
  const [subview, setSubview] = useState(true);
  useEffect(() => {
    const pop = () => {
      setSheet(Boolean(window.history.state?.selectedShow));
      setExternal(Boolean(window.history.state?.isPersonDetailModal));
      setOriginPerson(Boolean(window.history.state?.isOriginPerson));
    };
    const back = (event: Event) => { if (subview) { event.preventDefault(); setSubview(false); } };
    window.addEventListener('popstate', pop);
    window.addEventListener('profile-back-one-level', back);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('profile-back-one-level', back);
    };
  }, [subview]);
  const back = () => {
    if (closeTopDialog()) return;
    if (sheet) { window.history.back(); return; }
    if (closeTabSubview(tab)) return;
    setTab('watchlist');
  };
  Object.assign(window, { __dialogBack: back });
  return <main>
    <h1>SeenIt — pile de dialogues</h1>
    <p id="location">{sheet ? 'fiche' : subview ? 'sous-vue' : tab}</p>
    <button id="open-sheet" onClick={() => {
      window.history.pushState({ selectedShow: { id: 42 }, tab }, ''); setSheet(true);
    }}>Ouvrir la fiche</button>
    <button id="background" onClick={back}>Retour de navigation</button>
    <div id="bottom-nav" className="fixed bottom-0 inset-x-0 z-[160]">Navigation basse</div>
    <button id="open-origin-person" onClick={() => {
      window.history.pushState({ tab, selectedShow: null, isOriginPerson: true }, '');
      setOriginPerson(true);
    }}>Ouvrir une personne depuis l’onglet</button>
    {originPerson && <DialogLayer id="origin-person" label="Personne depuis l’onglet" historyMode="external" onDismiss={() => window.history.back()} className="fixed inset-0 bg-zinc-950 p-4">
      <button id="person-open-media" onClick={() => {
        window.history.pushState({ tab, selectedShow: { id: 42 } }, ''); setSheet(true);
      }}>Ouvrir un média de cette personne</button>
    </DialogLayer>}
    {sheet && <DialogLayer id="sheet" label="Fiche média" blocking={false} historyMode="external" onDismiss={() => window.history.back()} className="fixed inset-0 z-[150] bg-zinc-950 p-4">
      <h2>Fiche média</h2>
      <button id="open-dialog" onClick={() => setDialog(true)}>Ouvrir le dialogue</button>
      <button id="open-external" onClick={() => {
        window.history.pushState({ ...window.history.state, isPersonDetailModal: true }, '');
        setExternal(true);
      }}>Ouvrir la fiche personne</button>
      {dialog && <DialogLayer id="parent-dialog" label="Dialogue parent" onDismiss={() => setDialog(false)} className="fixed inset-0 flex items-center justify-center p-4 bg-black/70">
        <section className="w-full max-w-sm bg-zinc-950 p-5 rounded-2xl space-y-4">
          <h2>Dialogue parent</h2>
          <button id="parent-close" data-dialog-initial-focus onClick={() => setDialog(false)}>Fermer</button>
          <input id="parent-input" aria-label="Recherche" />
          <button id="open-child" onClick={() => setChild(true)}>Ouvrir la confirmation</button>
          <button id="lock" onClick={() => setLocked(true)}>Simuler une mise à jour en cours</button>
          <button id="replace" onClick={() => { setDialog(false); setReplacement(true); }}>Remplacer le dialogue</button>
          {child && <DialogLayer label="Confirmation enfant" role="alertdialog" canDismiss={!locked} onDismiss={() => setChild(false)} className="fixed inset-0 flex items-center justify-center p-4 bg-black/80">
            <section className="w-full max-w-sm bg-zinc-950 p-5 rounded-2xl space-y-4">
              <h2>Confirmation enfant</h2>
              <p>Une action destructive doit rester volontaire.</p>
              <button id="keep" data-dialog-initial-focus onClick={() => setChild(false)}>Garder</button>
              <button id="danger" onClick={() => setChild(false)}>Annuler le téléchargement</button>
              <button id="unlock" onClick={() => setLocked(false)}>Fin de mise à jour</button>
            </section>
          </DialogLayer>}
        </section>
      </DialogLayer>}
      {replacement && <DialogLayer label="Dialogue de remplacement" onDismiss={() => setReplacement(false)} className="fixed inset-0 bg-black/80 p-4">
        <button id="replacement-close" onClick={() => setReplacement(false)}>Fermer le remplacement</button>
      </DialogLayer>}
      {external && <DialogLayer label="Fiche personne" historyMode="external" onDismiss={() => window.history.back()} className="fixed inset-0 bg-black/80 p-4">
        <button id="external-close" onClick={() => window.history.back()}>Fermer la fiche personne</button>
        <button id="external-child" onClick={() => setChild(true)}>Ouvrir un dialogue local</button>
        {child && <DialogLayer label="Enfant local" onDismiss={() => setChild(false)} className="fixed inset-0 bg-black/80 p-4">
          <button id="external-child-close" onClick={() => setChild(false)}>Fermer l’enfant</button>
        </DialogLayer>}
      </DialogLayer>}
    </DialogLayer>}
  </main>;
}
window.history.replaceState({ tab: 'profile', selectedShow: null }, '');
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
