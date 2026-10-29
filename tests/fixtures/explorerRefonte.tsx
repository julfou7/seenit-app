import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscoverScreen } from '../../src/screens/DiscoverScreen';
import { BottomNav } from '../../src/components/BottomNav';
import { DialogLayer } from '../../src/components/ui/DialogLayer';
import { writeUserScopedJson } from '../../src/lib/userIsolation';
import { api } from './navbar13jRuntime';
import { telemetry, auth, useShowsStore, useToastStore } from './explorerRefonteRuntime';
const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0 });
Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
writeUserScopedJson('explorer-test', 'platforms', [8, 119, 1899]);
const original=useShowsStore.getState().shows[0];
useShowsStore.setState({shows:[original,{...original,id:'bb1396',tmdbId:1396,seenEpisodes:['1x1']}]});
interface MediaSelection { id: string | number; type?: 'tv' | 'movie'; season?: number; episode?: number }
function Harness() {
 const [tab, setTab] = useState('discover');
 const [request, setRequest] = useState<number>();
 const [media,setMedia]=useState<MediaSelection|null>(null);
 const message=useToastStore(state=>state.message);
 useEffect(()=>{const pop=(event:PopStateEvent)=>setMedia(event.state?.selectedShow||null);window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 const openMedia=(id:string|number,type?:'tv'|'movie',season?:number,episode?:number)=>{
  telemetry.opened.push(id);
  const selected={id,type,season,episode};
  window.history.pushState({tab:'discover',selectedShow:selected},'');
  setMedia(selected);
 };
 Object.assign(window, { __explorer: { telemetry, enabled: api.enabled, tab: setTab, shows: () => useShowsStore.getState().shows,
  clearToast:()=>useToastStore.setState({message:''}),
  uid:(uid:string)=>{auth.currentUser.uid=uid;useShowsStore.setState({shows:[...useShowsStore.getState().shows]});},
  keyboard: (height: number) => { viewport.height = height; viewport.dispatchEvent(new Event('resize')); } } });
 return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
   <div data-app-tab="discover" aria-hidden={tab !== 'discover'} style={{ display: tab === 'discover' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
     <DiscoverScreen navigationShortcut={request} onShowClick={openMedia} />
   </div>
   {media&&<DialogLayer label="Fiche média test" blocking={false} historyMode="external" onDismiss={()=>history.back()} style={{position:'fixed',inset:0,zIndex:150,background:'#09090b',padding:30}}>
    <p id="media-target">{media.id} {media.season}x{media.episode}</p>
    <button id="mark-character-seen" onClick={()=>useShowsStore.setState(state=>({shows:state.shows.map(show=>Number(show.tmdbId)===Number(media.id)?{...show,seenEpisodes:[...new Set([...show.seenEpisodes,'1x2'])]}:show)}))}>Marquer vu</button>
    <button id="back-from-media" onClick={()=>history.back()}>Retour personnage</button>
   </DialogLayer>}
   <BottomNav currentTab={tab} onTabChange={setTab} onLongPress={() => setRequest(previous => (previous || 0) + 1)} />
   {message&&<div id="toast-notification-wrapper" style={{position:'fixed',left:12,right:12,height:44,zIndex:3000,background:'#222',color:'white',borderRadius:20,padding:10}}>{message}</div>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
