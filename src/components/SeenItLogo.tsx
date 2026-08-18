import React from 'react';
import { cn } from '../lib/utils';

export type SeenItSymbolType = 'play' | 'watch' | 'library' | 'discover' | 'vip' | 'cinema';

export interface SeenItLogoProps {
  className?: string;
  size?: number;
  variant?: 'glyph' | 'icon' | 'horizontal' | 'badge' | 'text';
  symbol?: SeenItSymbolType;
  animated?: boolean;
}

/**
 * Pure Vector SVG Cinema TV & Symbol Ecosystem for SeenIt
 * Brand variations for:
 * - 'watch' / 'play': À Voir (En direct / Active Streaming)
 * - 'library': Ma Liste (Curated Vault / Personal Library)
 * - 'discover': Explorer (Cinema Discovery & Spark)
 * - 'vip': Profil VIP (Crown / Royal Star)
 * - 'cinema': Clapperboard / Big Screen
 */
export function SeenItGlyph({ 
  size = 32, 
  className = '', 
  symbol = 'play',
  glow = true,
  idPrefix = 'seenit'
}: { 
  size?: number; 
  className?: string; 
  symbol?: SeenItSymbolType;
  glow?: boolean;
  idPrefix?: string;
}) {
  const gradientId = `${idPrefix}-gold-grad`;
  const playGradId = `${idPrefix}-play-grad`;
  const glassId = `${idPrefix}-glass-grad`;

  // Scale stroke width slightly for small sizes to maintain crisp visibility
  const strokeW = size <= 28 ? 4.5 : size <= 36 ? 4.0 : 3.6;

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
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.04" />
          <stop offset="70%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Subtle Backlight Glow */}
      {glow && (
        <circle 
          cx="50" 
          cy="43" 
          r="20" 
          fill="#E5A93D" 
          opacity={size <= 28 ? "0.2" : "0.35"} 
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
        stroke={`url(#${gradientId})`}
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
      
      {/* 1. 'watch' / 'play' : Golden Cinema Play Icon */}
      {(symbol === 'play' || symbol === 'watch') && (
        <g>
          <path
            d="M 43 32.5 C 43 31.2 44.4 30.4 45.5 31.1 L 63 41.6 C 64 42.2 64 43.8 63 44.4 L 45.5 54.9 C 44.4 55.6 43 54.8 43 53.5 Z"
            fill={`url(#${playGradId})`}
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"
          />
        </g>
      )}

      {/* 2. 'library' : Curated Vault / Stacked Media Cards & Bookmark */}
      {symbol === 'library' && (
        <g>
          {/* Back subtle stacked card */}
          <rect
            x="34"
            y="28"
            width="32"
            height="22"
            rx="4"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.8"
            opacity="0.4"
          />
          {/* Main Vault Bookmark / Media Stack */}
          <rect
            x="38"
            y="32"
            width="24"
            height="26"
            rx="3.5"
            fill={`url(#${playGradId})`}
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.7))"
          />
          {/* Inner Bookmark Cutout */}
          <path
            d="M 45 32 L 45 42 L 50 39 L 55 42 L 55 32 Z"
            fill="#0B0B0F"
          />
        </g>
      )}

      {/* 3. 'discover' : Cinema Spark / Compass Star */}
      {symbol === 'discover' && (
        <g>
          <path
            d="M 50 28 C 50 36 56 42 64 43 C 56 44 50 50 50 58 C 50 50 44 44 36 43 C 44 42 50 36 50 28 Z"
            fill={`url(#${playGradId})`}
            filter="drop-shadow(0 0 6px rgba(245,197,24,0.6))"
          />
          <circle cx="50" cy="43" r="2.5" fill="#FFFFFF" />
        </g>
      )}

      {/* 4. 'vip' : Crown / Royal Crest */}
      {symbol === 'vip' && (
        <g>
          <path
            d="M 36 52 L 34 35 L 43 43 L 50 32 L 57 43 L 66 35 L 64 52 Z"
            fill={`url(#${playGradId})`}
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"
          />
          <circle cx="50" cy="47" r="1.8" fill="#0B0B0F" />
        </g>
      )}

      {/* 5. 'cinema' : Cinema Filmstrip */}
      {symbol === 'cinema' && (
        <g>
          <rect
            x="33"
            y="30"
            width="34"
            height="26"
            rx="4"
            fill={`url(#${playGradId})`}
          />
          <circle cx="39" cy="35" r="2" fill="#0B0B0F" />
          <circle cx="50" cy="35" r="2" fill="#0B0B0F" />
          <circle cx="61" cy="35" r="2" fill="#0B0B0F" />
          <circle cx="39" cy="51" r="2" fill="#0B0B0F" />
          <circle cx="50" cy="51" r="2" fill="#0B0B0F" />
          <circle cx="61" cy="51" r="2" fill="#0B0B0F" />
        </g>
      )}

      {/* TV Screen Stand Neck */}
      <path
        d="M 50 69 L 50 78.5"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />

      {/* TV Screen Stand Base */}
      <path
        d="M 32 79 C 32 79 41 78 50 78 C 59 78 68 79 68 79"
        stroke={`url(#${gradientId})`}
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
  symbol = 'play',
  animated = false,
}: SeenItLogoProps) {
  // Horizontal Brand Lockup (Icon + Typography)
  if (variant === 'horizontal') {
    const glyphSize = Math.max(26, Math.round(size * 0.38));
    return (
      <div className={cn("inline-flex items-center gap-2.5 select-none transform-gpu", className)}>
        <div className={cn("relative shrink-0 flex items-center justify-center", animated && "transition-transform duration-300 hover:scale-105")}>
          <SeenItGlyph size={glyphSize} symbol={symbol} idPrefix={`seenit-h-${symbol}`} />
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
        <SeenItGlyph size={14} symbol="vip" glow={false} idPrefix="seenit-badge" />
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
          <SeenItGlyph size={glyphSize} symbol={symbol} idPrefix={`seenit-tile-${symbol}-${size}`} />
        </div>
      </div>
    );
  }

  // Default: Pure Vector Glyph (Floating without box boundary)
  return <SeenItGlyph size={size} symbol={symbol} className={className} idPrefix={`seenit-g-${symbol}-${size}`} />;
}
