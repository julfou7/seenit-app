import type { ReactNode } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import { ActionSwipeCard } from './ActionSwipeCard';

/** Carte de série de l'accueil : glisser à gauche montre Archiver et Supprimer (classes `home-swipe` historiques). */
export function HomeSwipeCard({ children, onArchive, onRemove }: { children: ReactNode; onArchive: () => void; onRemove: () => void }) {
  return <ActionSwipeCard base="home-swipe" ignore="button:not(.series-8f__open),a,input" actions={[
    { label: 'Archiver', icon: <Archive size={18} />, tone: 'gold', onSelect: onArchive },
    { label: 'Supprimer', icon: <Trash2 size={18} />, tone: 'rose', onSelect: onRemove },
  ]}>{children}</ActionSwipeCard>;
}
