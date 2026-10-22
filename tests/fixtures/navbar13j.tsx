import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BottomNav } from '../../src/components/BottomNav';
import { QuickAccountSheet } from '../../src/components/QuickAccountSheet';
import { ToastContainer } from '../../src/components/ToastContainer';
import { DialogLayer } from '../../src/components/ui/DialogLayer';
import { activateCurrentNavigationTab, resetCurrentNavigationTab } from '../../src/features/navigation/navigationActions';
import { useTabShortcut } from '../../src/features/navigation/useTabShortcut';
import { useNavigation } from '../../src/features/navigation/useNavigation';
import { activateNavigationShortcut, openNavigationSettings } from '../../src/features/navigation/navigationShortcuts';
import { resolveRootNavigationTab } from '../../src/features/navigation/tabPresentation';
import { NAVIGATION_TABS, type RootNavigationTab } from '../../src/features/navigation/tabPresentation';
import { useToastStore } from '../../src/store/toastStore';
import { api, telemetry } from './navbar13jRuntime';
Object.defineProperty(navigator, 'vibrate', { value: (ms: number) => { telemetry.vibrations.push(ms); return true; } });
function Screen({ tab, active, shortcut }: { tab: RootNavigationTab; active: boolean; shortcut?: number }) {
  const [view, setView] = useState('secondary');
  const [query, setQuery] = useState('conservée');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reset = () => { setView('root'); setQuery(''); telemetry.resets.push(tab); ref.current?.scrollTo({top:0}); useToastStore.getState().showToast(tab+' réinitialisé.', 'info'); };
    const back = (event: Event) => { if (view !== 'root') { event.preventDefault(); setView('root'); } };
    window.addEventListener(tab+'-reset-all', reset); window.addEventListener(tab+'-back-one-level', back);
    return () => { window.removeEventListener(tab+'-reset-all', reset); window.removeEventListener(tab+'-back-one-level', back); };
  }, [tab, view]);
  useTabShortcut(shortcut, () => { telemetry.shortcuts.push(tab); setView(tab === 'downloads' ? 'search' : 'root'); const frame=requestAnimationFrame(() => ref.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true})); return () => cancelAnimationFrame(frame); });
  return <div data-app-tab={tab} style={{display:active?'flex':'none',height:'100dvh',flexDirection:'column'}}>
    <div className="overflow-y-auto pb-nav" ref={ref} style={{height:'100%',overflow:'auto',background:'linear-gradient(130deg,#161d38,#0c0c10 70%)'}}>
      <h1 style={{padding:24,fontSize:26,fontWeight:800}}>{NAVIGATION_TABS.find(item=>item.id===tab)?.label}</h1>
      <button id={tab+'-reset'} onClick={() => resetCurrentNavigationTab(tab)} style={{minHeight:44,padding:12}}>Réinitialiser la vue</button>
      <button id={tab+'-detail'} onClick={() => window.dispatchEvent(new Event('nav-detail'))} style={{minHeight:44,padding:12}}>Ouvrir une fiche</button>
      <p data-view={tab} style={{padding:16}}>Vue : {view}</p>
      <input data-search={tab} aria-label={'Recherche '+tab} value={query} onChange={event=>setQuery(event.target.value)} style={{minHeight:44,padding:12,border:'1px solid #888'}} />
      <div style={{height:1100,padding:24}}>Contenu de l’écran · aucun compte ni fournisseur contacté.</div>
      <button data-last-item style={{minHeight:44,padding:12}}>Dernier élément</button>
    </div>
  </div>;
}
function Harness() {
  const { currentTab: tab, changeTab: setTab } = useNavigation();
  const rootTab = resolveRootNavigationTab(tab) || 'watchlist';
  const [shortcut, setShortcut] = useState<{tab:RootNavigationTab;id:number}|null>(null);
  const sequence = useRef(0);
  const [quick, setQuick] = useState(false);
  const [detail, setDetail] = useState(false);
  useEffect(()=>{ const open=()=>setDetail(true);window.addEventListener('nav-detail',open);return()=>window.removeEventListener('nav-detail',open);},[]);
  const request = (target: RootNavigationTab) => setShortcut({ tab: target, id: ++sequence.current });
  const long = (target:RootNavigationTab) => activateNavigationShortcut(tab, target, { changeTab: setTab, request, quickAccount: () => { telemetry.shortcuts.push('profile');setQuick(true); } });
  Object.assign(window,{__nav13j:{...api,clearToasts:()=>useToastStore.getState().clearQueue(),toast:()=>useToastStore.getState().showToast('Une confirmation lisible au-dessus de la barre.','info'),detail:()=>setDetail(true),tab:()=>tab}});
  return <div>
    {NAVIGATION_TABS.map(item=><Screen key={item.id} tab={item.id} active={tab===item.id} shortcut={tab===item.id&&shortcut?.tab===item.id?shortcut.id:undefined}/>)}
    <BottomNav currentTab={tab} onTabChange={setTab} onActiveTabClick={()=>activateCurrentNavigationTab(rootTab)} onActiveTabDoubleClick={()=>resetCurrentNavigationTab(rootTab)} onLongPress={long}/>
    {quick&&<QuickAccountSheet onClose={()=>setQuick(false)} onSettings={()=>{setQuick(false);openNavigationSettings(tab,{changeTab:setTab,request});}}/>}
    {detail&&<DialogLayer label="Fiche média" blocking={false} historyMode="external" onDismiss={()=>setDetail(false)} className="fixed inset-0 bg-zinc-950"><h2>Fiche média</h2><button type="button" style={{minHeight:44,padding:16}} onClick={()=>setDetail(false)}>Retour à la liste</button></DialogLayer>}
    <ToastContainer />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
