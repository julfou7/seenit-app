import React from 'react';
import { User } from 'lucide-react';
import { type TMDBMedia } from '../../features/shows/tmdb';
import { cn } from '../../lib/utils';

interface PersonCardProps {
  key?: React.Key;
  person: TMDBMedia;
  onClick: (personId: number) => void;
  isRowItem?: boolean;
}

export const PersonCard = React.memo(function PersonCard({ person, onClick, isRowItem = false }: PersonCardProps) {
  const displayName = person.name || 'Inconnu';
  
  const character = (person as any).character;
  const characterShow = (person as any).characterShow;

  let department = 'Artiste';
  if (character) {
    department = `Rôle : ${character}${characterShow ? ` (${characterShow})` : ''}`;
  } else if (person.known_for_department === 'Acting') {
    department = 'Acteur / Actrice';
  } else if (person.known_for_department === 'Directing') {
    department = 'Réalisateur';
  } else if (person.known_for_department === 'Writing') {
    department = 'Scénariste';
  } else if (person.known_for_department === 'Production') {
    department = 'Producteur';
  } else if (person.known_for_department) {
    department = person.known_for_department;
  }

  // Initiales en cas d'absence d'image
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div 
      onClick={() => onClick(person.id)}
      className={cn(
        "flex flex-col items-center text-center cursor-pointer group bg-[#1C1C1E] border border-white/5 hover:border-[#E5A93D]/30 transition-all duration-200 touch-manipulation active:scale-95",
        isRowItem ? "w-[calc((100vw-0.5rem-12px)/3)] sm:w-[calc((100vw-0.5rem-18px)/4)] p-2 shrink-0 rounded-xl snap-start" : "w-full p-2.5 sm:p-3 rounded-2xl"
      )}
    >
      <div className={cn(
        "rounded-full overflow-hidden bg-zinc-800 relative shadow-md group-hover:scale-105 transition-transform duration-200 border-2 border-white/10 group-hover:border-[#E5A93D]/50",
        isRowItem ? "w-14 h-14 sm:w-16 sm:h-16 mb-1.5" : "w-16 h-16 sm:w-20 sm:h-20 mb-2"
      )}>
        {person.profile_path ? (
          <img 
            loading="lazy"
            decoding="async"
            src={`https://image.tmdb.org/t/p/w185${person.profile_path}`} 
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 text-zinc-400 font-bold text-sm sm:text-base">
            {initials ? (
              <span>{initials}</span>
            ) : (
              <User size={20} className="text-zinc-500" />
            )}
          </div>
        )}
      </div>

      <h3 className="text-[11px] sm:text-xs font-bold text-white line-clamp-1 w-full" title={displayName}>{displayName}</h3>
      <p className="text-[9px] sm:text-[10px] font-medium text-[#E5A93D] line-clamp-2 mt-0.5 leading-tight">{department}</p>
    </div>
  );
});

