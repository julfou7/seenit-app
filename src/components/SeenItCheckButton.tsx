import React, { useState } from 'react';
import { cn } from '../lib/utils';

export interface SeenItCheckButtonProps {
  onClick: (e: React.MouseEvent) => void;
  isWatched?: boolean;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * SeenIt Signature Cinema TV Action Button
 * Replaces generic circle checkboxes with the iconic SeenIt TV & validation check glyph.
 */
export function SeenItCheckButton({
  onClick,
  isWatched = false,
  size = 28,
  className = '',
  title = 'Marquer comme vu'
}: SeenItCheckButtonProps) {
  const [isTapped, setIsTapped] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsTapped(true);
    setTimeout(() => setIsTapped(false), 1200);
    onClick(e);
  };

  const active = isWatched || isTapped;

  return (
    <button
      onClick={handleClick}
      title={title}
      aria-label={title}
      className={cn(
        "group relative flex items-center justify-center rounded-xl p-1.5 transition-all duration-200 cursor-pointer select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50",
        active ? "scale-105" : "hover:scale-105 active:scale-90",
        className
      )}
      style={{ touchAction: 'manipulation' }}
    >
      {/* Subtle Hover / Active Gold Aura */}
      <div 
        className={cn(
          "absolute inset-0 rounded-xl transition-all duration-300 pointer-events-none",
          active 
            ? "bg-amber-500/20 shadow-[0_0_14px_rgba(245,197,24,0.4)] opacity-100" 
            : "opacity-0 group-hover:opacity-100 group-hover:bg-amber-500/10 group-hover:shadow-[0_0_10px_rgba(245,197,24,0.2)]"
        )}
      />

      {/* Bespoke Cinema TV Emblem SVG */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 overflow-visible transform-gpu transition-all duration-200"
      >
        <defs>
          {/* Radiant Gold Gradient */}
          <linearGradient id="btn-gold-grad" x1="10%" y1="10%" x2="90%" y2="90%">
            <stop offset="0%" stopColor="#FFF2B8" />
            <stop offset="30%" stopColor="#F5C518" />
            <stop offset="70%" stopColor="#E5A93D" />
            <stop offset="100%" stopColor="#B37812" />
          </linearGradient>

          {/* Muted Resting Bezel Gradient */}
          <linearGradient id="btn-idle-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#52525B" />
            <stop offset="100%" stopColor="#3F3F46" />
          </linearGradient>

          {/* Glass Highlight */}
          <linearGradient id="btn-glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.25" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* TV Screen Outer Frame */}
        <rect
          x="14"
          y="18"
          width="72"
          height="52"
          rx="10"
          className={cn(
            "transition-all duration-300",
            active 
              ? "fill-[#0B0B10] stroke-[url(#btn-gold-grad)]" 
              : "fill-black/40 stroke-zinc-600/80 group-hover:stroke-[url(#btn-gold-grad)] group-hover:fill-[#0B0B10]"
          )}
          strokeWidth={active ? "4.2" : "3.6"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Diagonal Glass Sheen */}
        <path
          d="M 16 28 L 68 20 L 16 62 Z"
          fill="url(#btn-glass-grad)"
          className={cn("transition-opacity duration-200", active ? "opacity-90" : "opacity-40 group-hover:opacity-80")}
        />

        {/* TV Stand Neck */}
        <path
          d="M 50 70 L 50 79"
          className={cn(
            "transition-all duration-300",
            active 
              ? "stroke-[url(#btn-gold-grad)]" 
              : "stroke-zinc-600/80 group-hover:stroke-[url(#btn-gold-grad)]"
          )}
          strokeWidth="3.6"
          strokeLinecap="round"
        />

        {/* TV Stand Base */}
        <path
          d="M 32 80 C 32 80 41 78.5 50 78.5 C 59 78.5 68 80 68 80"
          className={cn(
            "transition-all duration-300",
            active 
              ? "stroke-[url(#btn-gold-grad)]" 
              : "stroke-zinc-600/80 group-hover:stroke-[url(#btn-gold-grad)]"
          )}
          strokeWidth="3.6"
          strokeLinecap="round"
        />

        {/* Inside Core: SeenIt Signature Cinema Checkmark ("VU !") */}
        <g className="transform-gpu transition-all duration-200">
          {/* Inner TV text shown temporarily on tap */}
          <text
            x="50"
            y="49"
            textAnchor="middle"
            alignmentBaseline="middle"
            fill="url(#btn-gold-grad)"
            className={cn(
              "text-[16px] font-black tracking-tighter font-sans transition-all duration-300",
              isTapped ? "opacity-100 scale-100" : "opacity-0 scale-50"
            )}
            style={{ textShadow: '0 0 10px rgba(245,197,24,0.5)', transformOrigin: '50px 44px' }}
          >
            <tspan x="50" dy="-0.2em">SEEN</tspan>
            <tspan x="50" dy="1.1em">IT!</tspan>
          </text>

          {/* Subtle Checkmark Outline / Filled Glow */}
          <path
            d="M 38 44 L 46 52 L 62 34"
            fill="none"
            className={cn(
              "transition-all duration-200",
              active && !isTapped
                ? "stroke-[url(#btn-gold-grad)] opacity-100" 
                : "stroke-zinc-500/70 group-hover:stroke-amber-300/90 opacity-60 group-hover:opacity-100",
              isTapped ? "opacity-0 scale-75" : "scale-100"
            )}
            strokeWidth={active ? "6.2" : "5.0"}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transformOrigin: '50px 44px' }}
          />

          {/* Golden Apex Sparkle when active */}
          {active && !isTapped && (
            <circle
              cx="62"
              cy="34"
              r="2"
              fill="#FFFFFF"
              className="animate-ping duration-500"
            />
          )}
        </g>
      </svg>
    </button>
  );
}
