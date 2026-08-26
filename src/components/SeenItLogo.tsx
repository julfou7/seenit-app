import React from 'react';
import { cn } from '../lib/utils';

export type SeenItSymbolType = 'check' | 'play' | 'watch' | 'library' | 'discover' | 'vip' | 'cinema' | 'profile' | 'download';

export interface SeenItLogoProps {
  className?: string;
  size?: number;
  variant?: 'glyph' | 'icon' | 'horizontal' | 'badge' | 'text';
  symbol?: SeenItSymbolType;
  animated?: boolean;
  active?: boolean;
}

/**
 * Pure Vector SVG Cinema TV & Symbol Ecosystem for SeenIt
 * Official Brand Emblem:
 * - 'watch' / 'play': Cinema Play Triangle inside Cinema TV Screen
 * - 'check': Official Verification Checkmark inside Cinema TV Screen
 * - 'library': Ma Liste (Curated Vault / Personal Library)
 * - 'discover': Explorer (Cinema Discovery Spark & Compass)
 * - 'profile': Profil (User Silhouette / Cinephile Account)
 * - 'vip': Profil VIP (Crown / Royal Star)
 * - 'cinema': Clapperboard / Big Screen
 */
export function SeenItGlyph({ 
  size = 32, 
  className = '', 
  symbol = 'check',
  glow = true,
  active = true,
  idPrefix = 'seenit'
}: { 
  size?: number; 
  className?: string; 
  symbol?: SeenItSymbolType;
  glow?: boolean;
  active?: boolean;
  idPrefix?: string;
}) {
  const gradientId = `${idPrefix}-gold-grad`;
  const playGradId = `${idPrefix}-play-grad`;
  const glassId = `${idPrefix}-glass-grad`;

  // Scale stroke width slightly for small sizes to maintain crisp visibility
  const strokeW = size <= 28 ? 4.8 : size <= 36 ? 4.2 : 3.6;

  const frameStroke = active ? `url(#${gradientId})` : '#71717A';
  const symbolFill = active ? `url(#${playGradId})` : '#71717A';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("select-none shrink-0 transform-gpu", className)}
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Luxury Apple TV Gold Gradient */}
        <linearGradient id={gradientId} x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="#FFF2B8" />
          <stop offset="30%" stopColor="#F5C518" />
          <stop offset="70%" stopColor="#E5A93D" />
          <stop offset="100%" stopColor="#B37812" />
        </linearGradient>

        {/* High-Contrast Core Symbol Gradient */}
        <linearGradient id={playGradId} x1="15%" y1="15%" x2="85%" y2="85%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="25%" stopColor="#FFEAA0" />
          <stop offset="65%" stopColor="#F5C518" />
          <stop offset="100%" stopColor="#D98A11" />
        </linearGradient>

        {/* Glass Screen Reflection Highlight */}
        <linearGradient id={glassId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={active ? "0.22" : "0.08"} />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity={active ? "0.04" : "0.01"} />
          <stop offset="70%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Subtle Backlight Glow */}
      {glow && active && (
        <circle 
          cx="50" 
          cy="43" 
          r="22" 
          fill="#E5A93D" 
          opacity={size <= 28 ? "0.28" : "0.38"} 
          className="blur-[6px] pointer-events-none"
        />
      )}

      {/* Cinema Screen Outer Frame (Rounded Bezel) */}
      <rect
        x="14"
        y="17"
        width="72"
        height="52"
        rx="10"
        fill="#0B0B0F"
        stroke={frameStroke}
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Diagonal Glass Sheen Reflection */}
      <path
        d="M 16 26 L 68 18 L 16 60 Z"
        fill={`url(#${glassId})`}
      />

      {/* ---------------- SYMBOL VARIATIONS ---------------- */}
      
      {/* 1. 'play' / 'watch' : Sleek Cinema Play Triangle */}
      {(symbol === 'play' || symbol === 'watch') && (
        <g>
          <path
            d="M 43 32.5 L 65 43.5 L 43 54.5 Z"
            fill={symbolFill}
            stroke={frameStroke}
            strokeWidth={size <= 28 ? "1.5" : "1.2"}
            strokeLinejoin="round"
            filter={active ? "drop-shadow(0 2px 5px rgba(0,0,0,0.7))" : undefined}
          />
        </g>
      )}

      {/* 2. 'check' : Official Golden Verification Checkmark Icon */}
      {symbol === 'check' && (
        <g>
          <path
            d="M 38 44 L 46 52 L 62 34"
            fill="none"
            stroke={symbolFill}
            strokeWidth={size <= 28 ? "6.8" : "6.0"}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={active ? "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" : undefined}
          />
        </g>
      )}

      {/* 3. 'library' : Curated Vault / Stacked Media Cards & Bookmark */}
      {symbol === 'library' && (
        <g>
          {/* Back subtle stacked card */}
          <rect
            x="34"
            y="27"
            width="32"
            height="22"
            rx="4"
            fill="none"
            stroke={active ? `url(#${gradientId})` : '#52525B'}
            strokeWidth={size <= 28 ? "2.2" : "1.8"}
            opacity={active ? "0.45" : "0.3"}
          />
          {/* Main Vault Bookmark / Media Stack */}
          <rect
            x="38"
            y="31"
            width="24"
            height="27"
            rx="3.5"
            fill={symbolFill}
            filter={active ? "drop-shadow(0 2px 5px rgba(0,0,0,0.7))" : undefined}
          />
          {/* Inner Bookmark Cutout */}
          <path
            d="M 45 31 L 45 42 L 50 38.5 L 55 42 L 55 31 Z"
            fill="#0B0B0F"
          />
        </g>
      )}

      {/* 4. 'discover' : Cinema Spark / Compass Star */}
      {symbol === 'discover' && (
        <g>
          <path
            d="M 50 26 C 50 35 56 42 65 43 C 56 44 50 51 50 60 C 50 51 44 44 35 43 C 44 42 50 35 50 26 Z"
            fill={symbolFill}
            filter={active ? "drop-shadow(0 0 7px rgba(245,197,24,0.7))" : undefined}
          />
          <circle cx="50" cy="43" r={size <= 28 ? 2.8 : 2.5} fill={active ? "#FFFFFF" : "#0B0B0F"} />
        </g>
      )}

      {/* 5. 'profile' : User Silhouette / Cinephile Account */}
      {symbol === 'profile' && (
        <g>
          {/* User Head */}
          <circle cx="50" cy="34" r="7.5" fill={symbolFill} />
          {/* User Body / Shoulders */}
          <path
            d="M 33 55 C 33 45.5 40.5 44.5 50 44.5 C 59.5 44.5 67 45.5 67 55 Z"
            fill={symbolFill}
            filter={active ? "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" : undefined}
          />
        </g>
      )}

      {/* 6. 'vip' : Crown / Royal Crest */}
      {symbol === 'vip' && (
        <g>
          <path
            d="M 36 52 L 34 35 L 43 43 L 50 32 L 57 43 L 66 35 L 64 52 Z"
            fill={symbolFill}
            filter={active ? "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" : undefined}
          />
          <circle cx="50" cy="47" r="1.8" fill="#0B0B0F" />
        </g>
      )}

      {/* 7. 'cinema' : Cinema Filmstrip */}
      {symbol === 'cinema' && (
        <g>
          <rect
            x="33"
            y="30"
            width="34"
            height="26"
            rx="4"
            fill={symbolFill}
          />
          <circle cx="39" cy="35" r="2" fill="#0B0B0F" />
          <circle cx="50" cy="35" r="2" fill="#0B0B0F" />
          <circle cx="61" cy="35" r="2" fill="#0B0B0F" />
          <circle cx="39" cy="51" r="2" fill="#0B0B0F" />
          <circle cx="50" cy="51" r="2" fill="#0B0B0F" />
          <circle cx="61" cy="51" r="2" fill="#0B0B0F" />
        </g>
      )}

      {/* 8. 'download' : Download Arrow in Cinema TV Screen */}
      {symbol === 'download' && (
        <g>
          {/* Vertical Arrow stem */}
          <path
            d="M 50 28 L 50 48"
            stroke={symbolFill}
            strokeWidth={size <= 28 ? "5" : "4.2"}
            strokeLinecap="round"
          />
          {/* Arrow Head */}
          <path
            d="M 41 41 L 50 50 L 59 41"
            fill="none"
            stroke={symbolFill}
            strokeWidth={size <= 28 ? "5" : "4.2"}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Tray base */}
          <path
            d="M 36 53 L 36 57 C 36 59 38 60 40 60 L 60 60 C 62 60 64 59 64 57 L 64 53"
            fill="none"
            stroke={symbolFill}
            strokeWidth={size <= 28 ? "4" : "3.5"}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      {/* TV Screen Stand Neck */}
      <path
        d="M 50 69 L 50 78.5"
        stroke={frameStroke}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />

      {/* TV Screen Stand Base */}
      <path
        d="M 32 79 C 32 79 41 78 50 78 C 59 78 68 79 68 79"
        stroke={frameStroke}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SeenItLogo({
  className = '',
  size = 32,
  variant = 'glyph',
  symbol = 'check',
  animated = false,
  active = true,
}: SeenItLogoProps) {
  // Horizontal Brand Lockup (Icon + Typography)
  if (variant === 'horizontal') {
    const glyphSize = Math.max(26, Math.round(size * 0.38));
    return (
      <div className={cn("inline-flex items-center gap-2.5 select-none transform-gpu", className)}>
        <div className={cn("relative shrink-0 flex items-center justify-center", animated && "transition-transform duration-300 hover:scale-105")}>
          <SeenItGlyph size={glyphSize} symbol={symbol} active={active} idPrefix={`seenit-h-${symbol}`} />
        </div>
        <div className="flex items-baseline tracking-tight font-black font-sans leading-none" style={{ fontSize: `${Math.round(size * 0.36)}px` }}>
          <span className="text-white">Seen</span>
          <span className="bg-gradient-to-r from-[#FFE28A] via-[#F5C518] to-[#E5A93D] bg-clip-text text-transparent ml-[1px]">
            It
          </span>
        </div>
      </div>
    );
  }

  // VIP / Tag Badge
  if (variant === 'badge') {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 bg-gradient-to-r from-[#E5A93D]/15 to-[#E5A93D]/5 border border-[#E5A93D]/30 px-2.5 py-1 rounded-full text-xs font-bold text-[#E5A93D] shadow-[0_0_12px_rgba(229,169,61,0.15)] select-none backdrop-blur-md transform-gpu",
        className
      )}>
        <SeenItGlyph size={14} symbol="vip" glow={false} active={active} idPrefix="seenit-badge" />
        <span className="tracking-wide">SeenIt VIP</span>
      </div>
    );
  }

  // Pure Text Branding
  if (variant === 'text') {
    return (
      <span className={cn("font-black tracking-tight select-none", className)}>
        <span className="text-white">Seen</span>
        <span className="bg-gradient-to-r from-[#FFE28A] via-[#F5C518] to-[#E5A93D] bg-clip-text text-transparent ml-[1px]">
          It
        </span>
      </span>
    );
  }

  // App Tile / Icon Container (like Apple App Icon)
  if (variant === 'icon') {
    const glyphSize = Math.round(size * 0.68);
    return (
      <div
        style={{ width: `${size}px`, height: `${size}px` }}
        className={cn(
          "relative rounded-[22%] overflow-hidden bg-gradient-to-b from-[#18181c] via-[#101014] to-[#08080a] border border-white/10 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.8)] ring-1 ring-white/5 flex items-center justify-center shrink-0 select-none group transform-gpu",
          animated && "transition-all duration-300 hover:scale-105 hover:border-[#E5A93D]/30 hover:shadow-[#E5A93D]/10",
          className
        )}
      >
        {/* Subtle Ambient Radial Backlight */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(229,169,61,0.18),transparent_70%)] pointer-events-none" />
        
        {/* Subtle Edge Reflection */}
        <div className="absolute inset-0 rounded-[22%] bg-gradient-to-tr from-white/[0.08] to-transparent pointer-events-none" />

        <div className="relative z-10 flex items-center justify-center">
          <SeenItGlyph size={glyphSize} symbol={symbol} active={active} idPrefix={`seenit-tile-${symbol}-${size}`} />
        </div>
      </div>
    );
  }

  // Default: Pure Vector Glyph (Floating without box boundary)
  return <SeenItGlyph size={size} symbol={symbol} active={active} className={className} idPrefix={`seenit-g-${symbol}-${size}`} />;
}
