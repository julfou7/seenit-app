import React, { useId } from 'react';
import { cn } from '../lib/utils';
export type SeenItSymbolType = 'check' | 'play' | 'watch' | 'library' | 'discover' | 'vip' | 'cinema' | 'profile' | 'download';
export interface SeenItLogoProps { className?: string; size?: number; variant?: 'glyph' | 'icon' | 'horizontal' | 'badge' | 'text'; symbol?: SeenItSymbolType; animated?: boolean; active?: boolean }
const BrandGold = ({ id }: { id: string }) => <defs><linearGradient id={id} x1="10%" y1="5%" x2="90%" y2="95%"><stop offset="0%" stopColor="#FFF2B8"/><stop offset="32%" stopColor="#F5C518"/><stop offset="70%" stopColor="#E5A93D"/><stop offset="100%" stopColor="#B37812"/></linearGradient></defs>;
/**
 * Cloche de rappel au trait de l'anneau Vu (retour terrain du 18/11 : « une cloche aussi épaisse que Vu et Télécharger,
 * pour une identité commune », puis « enlève le rond, c'est trop imposant ») : la cloche seule, même épaisseur que le
 * coche ; or quand les rappels sont actifs.
 */
export function SeenItBellRing({ size = 42, active = false, className = '' }: { size?: number; active?: boolean; className?: string }) {
  const id = useId();
  const ink = active ? 'url(#' + id + ')' : '#A1A1AA';
  return <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true" data-brand-bell data-active={active}>
    {active && <BrandGold id={id}/>}
    <path d="M28 44a22 22 0 0 1 44 0c0 15 8 20 8 20H20s8-5 8-20" stroke={ink} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M41 77a10 10 0 0 0 18 0" stroke={ink} strokeWidth="9" strokeLinecap="round"/>
  </svg>;
}
export function SeenItRing({ size = 42, active = true, className = '' }: { size?: number; active?: boolean; className?: string }) {
  const id = useId();
  return <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true" data-brand-ring data-active={active}>
    <BrandGold id={id}/>
    <circle className="brand-ring-track" cx="50" cy="50" r="38" fill="none" stroke="#A1A1AA" strokeWidth="10"/>
    <circle className="brand-ring-fill" cx="50" cy="50" r="38" fill="none" stroke={'url(#'+id+')'} strokeWidth="10" strokeLinecap="round" strokeDasharray="239 239" strokeDashoffset={active ? 0 : 239} transform="rotate(-90 50 50)"/>
    <path className="brand-ring-tick" pathLength="1" d="M36 51 L46 61 L65 40" fill="none" stroke={active ? 'url(#'+id+')' : '#A1A1AA'} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
/** Flèche du logo Télécharger (repère 24 px), la même que le contrôle d'épisode du mode téléchargement. */
const DOWNLOAD_ARROW = 'M12 7.2v8.4M8.6 12.3l3.4 3.4 3.4-3.4';
/**
 * Logo Télécharger de SeenIt (08/11/2026) : une flèche dans un cercle, repris du contrôle d'épisode du
 * mode téléchargement et appliqué à toute la fonction (navigation, fiches, onglet, réglages). Contour
 * par défaut ; `filled` remplit le cercle et passe la flèche en sombre. La couleur suit `currentColor`.
 */
export function DownloadMark({ size = 24, filled = false, className = '', strokeWidth = 2 }: { size?: number; filled?: boolean; className?: string; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" data-download-mark={filled ? 'filled' : 'outline'}>
    {filled ? <circle cx="12" cy="12" r="10" fill="currentColor"/> : <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={strokeWidth}/>}
    <path d={DOWNLOAD_ARROW} stroke={filled ? '#0B0B0D' : 'currentColor'} strokeWidth={filled ? strokeWidth + 0.4 : strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
export function SeenItGlyph({ size = 32, className = '', symbol = 'check', active = true, color, navigation = false }: { size?: number; className?: string; symbol?: SeenItSymbolType; glow?: boolean; active?: boolean; idPrefix?: string; color?: 'gold' | 'blue'; navigation?: boolean }) {
  if (symbol === 'check') return <SeenItRing size={size} active={active} className={className}/>;
  const ink = active ? color === 'blue' ? '#60a5fa' : '#E5A93D' : '#71717A';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" data-brand-navigation={navigation || undefined}>
    {(symbol === 'watch' || symbol === 'play' || symbol === 'library') && <><path d="M7.5 4H18a3 3 0 0 1 3 3v9"/><rect x="3" y="7.5" width="15" height="12.5" rx="3" fill={active ? ink : 'none'}/><path d="M6.5 16.5h5" stroke={active ? '#08080C' : ink}/></>}
    {symbol === 'discover' && <><circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z" fill={active ? ink : 'none'}/></>}
    {(symbol === 'profile' || symbol === 'vip') && <><circle cx="12" cy="8.5" r="3.8" fill={active ? ink : 'none'}/><path d="M4.5 20c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5" fill={active ? ink : 'none'}/></>}
    {symbol === 'download' && <><circle cx="12" cy="12" r="9" fill={active ? ink : 'none'}/><path d={DOWNLOAD_ARROW} stroke={active ? '#08080C' : ink}/></>}
    {symbol === 'cinema' && <><rect x="3" y="8" width="18" height="13" rx="2"/><path d="m3 8 17-5 1 5M6 7l2-3m4 2 2-3M3 13h18"/></>}
  </svg>;
}
export function SeenItLogo({ className = '', size = 32, variant = 'glyph', symbol = 'check', active = true }: SeenItLogoProps) {
  if (variant === 'horizontal' || variant === 'text') return <img className={cn('seenit-brand-logo', className)} src="/brand/seenit-logo-sombre.svg" alt="SeenIt" style={{ height: variant === 'text' ? '1em' : size, width:'auto', objectFit:'contain' }}/>;
  if (variant === 'badge') return <span className={cn('inline-flex items-center gap-1 text-amber-400 font-bold',className)}><SeenItRing size={16}/>SeenIt VIP</span>;
  if (variant === 'icon') return <img className={className} src="/brand/seenit-icone.svg" width={size} height={size} alt="SeenIt"/>;
  return <SeenItGlyph size={size} className={className} symbol={symbol} active={active}/>;
}
