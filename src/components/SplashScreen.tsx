import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  onStartClose?: () => void;
  isReady: boolean;
  minimumDisplayTime?: number;
  animate?: boolean;
}

export function SplashScreen({ 
  onComplete, 
  onStartClose,
  isReady, 
  minimumDisplayTime = 2200,
  animate = true
}: SplashScreenProps) {
  const [timeElapsed, setTimeElapsed] = useState(minimumDisplayTime === 0);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (minimumDisplayTime === 0) {
      setTimeElapsed(true);
      return;
    }
    const timer = setTimeout(() => {
      setTimeElapsed(true);
    }, minimumDisplayTime);

    return () => clearTimeout(timer);
  }, [minimumDisplayTime]);

  useEffect(() => {
    if (timeElapsed && isReady && !isClosing) {
      setIsClosing(true);
      if (onStartClose) onStartClose();
      const closeTimer = setTimeout(() => {
        onComplete();
      }, 500);
      return () => clearTimeout(closeTimer);
    }
  }, [timeElapsed, isReady, isClosing, onComplete, onStartClose]);

  return (
    <div
      id="seenit-splash-screen"
      className={`fixed inset-0 z-[999] bg-[#040406] flex flex-col items-center justify-center overflow-hidden select-none transition-opacity duration-500 ease-out ${
        isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* 120 FPS Ultra-Smooth GPU Keyframes */}
      {animate && (
        <style>{`
          @keyframes cinematicLogoIn {
            0% {
              transform: scale(0.88) translateY(6px) translate3d(0, 0, 0);
              opacity: 0;
            }
            100% {
              transform: scale(1) translateY(0) translate3d(0, 0, 0);
              opacity: 1;
            }
          }

          @keyframes checkmarkStamp {
            0% {
              transform: scale(0.5) translate3d(0, 0, 0);
              opacity: 0;
            }
            45% {
              opacity: 1;
            }
            75% {
              transform: scale(1.12) translate3d(0, 0, 0);
            }
            100% {
              transform: scale(1) translate3d(0, 0, 0);
              opacity: 1;
            }
          }

          @keyframes stampBurst {
            0% {
              transform: scale(0.4) translate3d(0, 0, 0);
              opacity: 0;
            }
            40% {
              opacity: 0.6;
            }
            100% {
              transform: scale(1.6) translate3d(0, 0, 0);
              opacity: 0;
            }
          }

          @keyframes ambientBloomBreath {
            0% {
              opacity: 0.1;
            }
            50% {
              opacity: 0.45;
            }
            100% {
              opacity: 0.3;
            }
          }

          @keyframes titleFadeUp {
            0% {
              transform: translateY(12px) translate3d(0, 0, 0);
              opacity: 0;
            }
            100% {
              transform: translateY(0) translate3d(0, 0, 0);
              opacity: 1;
            }
          }

          @keyframes subtitleFadeUp {
            0% {
              transform: translateY(8px) translate3d(0, 0, 0);
              opacity: 0;
            }
            100% {
              transform: translateY(0) translate3d(0, 0, 0);
              opacity: 0.7;
            }
          }

          @keyframes microLoaderSweep {
            0% { transform: translateX(-100%) translate3d(0, 0, 0); }
            100% { transform: translateX(100%) translate3d(0, 0, 0); }
          }

          .anim-bloom {
            animation: ambientBloomBreath 2.4s ease-in-out forwards;
          }

          .anim-emblem {
            animation: cinematicLogoIn 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }

          .anim-seen-check {
            transform-origin: 100px 86px;
            animation: checkmarkStamp 0.85s cubic-bezier(0.34, 1.4, 0.64, 1) 0.18s forwards;
            opacity: 0;
          }

          .anim-stamp-burst {
            transform-origin: 100px 86px;
            animation: stampBurst 0.9s ease-out 0.3s forwards;
            opacity: 0;
          }

          .anim-title {
            animation: titleFadeUp 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards;
            opacity: 0;
          }

          .anim-subtitle {
            animation: subtitleFadeUp 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards;
            opacity: 0;
          }

          .anim-loader-bar {
            animation: microLoaderSweep 1.4s ease-in-out infinite 0.1s;
          }
        `}</style>
      )}

      {/* 1. Cinematic Ambient Backlight Glow */}
      <div 
        className={`${animate ? 'anim-bloom' : 'opacity-30 scale-100'} absolute w-[340px] h-[340px] rounded-full pointer-events-none`}
        style={{
          background: 'radial-gradient(circle, rgba(245,197,24,0.18) 0%, rgba(217,119,6,0.05) 50%, transparent 70%)',
          transform: 'translate3d(0, 0, 0)'
        }}
      />

      {/* 2. Main Centered Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        
        {/* Emblem TV Vector Graphic */}
        <div className={`relative w-28 h-28 flex items-center justify-center mb-5 ${animate ? 'anim-emblem' : ''}`}>
          <svg
            width="112"
            height="112"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            shapeRendering="geometricPrecision"
            className="overflow-visible select-none"
            style={{ transform: 'translate3d(0, 0, 0)' }}
          >
            <defs>
              {/* Luxury Gold Gradient */}
              <linearGradient id="splash-gold-grad" x1="10%" y1="10%" x2="90%" y2="90%">
                <stop offset="0%" stopColor="#FFF4D0" />
                <stop offset="25%" stopColor="#FDE68A" />
                <stop offset="55%" stopColor="#F5C518" />
                <stop offset="85%" stopColor="#E5A93D" />
                <stop offset="100%" stopColor="#B37812" />
              </linearGradient>

              {/* High-Impact Gold Core Gradient */}
              <linearGradient id="splash-check-grad" x1="15%" y1="15%" x2="85%" y2="85%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="20%" stopColor="#FFF2B8" />
                <stop offset="55%" stopColor="#F5C518" />
                <stop offset="85%" stopColor="#E5A93D" />
                <stop offset="100%" stopColor="#D97706" />
              </linearGradient>

              {/* Glass Reflection Highlight */}
              <linearGradient id="splash-glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
                <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.03" />
                <stop offset="70%" stopColor="#000000" stopOpacity="0" />
              </linearGradient>

              {/* Laser Shimmer Light */}
              <linearGradient id="splash-shimmer-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>

              {/* Screen Inner Clip */}
              <clipPath id="splash-inner-screen">
                <rect x="28" y="34" width="144" height="104" rx="20" />
              </clipPath>
            </defs>

            {/* Ambient TV Glow (Optimized) */}
            <rect
              x="26"
              y="32"
              width="148"
              height="108"
              rx="22"
              fill="#E5A93D"
              fillOpacity="0.08"
            />

            {/* Cinema Screen Outer Frame (Rounded Bezel) */}
            <rect
              x="28"
              y="34"
              width="144"
              height="104"
              rx="20"
              fill="#08080C"
              stroke="url(#splash-gold-grad)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Diagonal Glass Sheen Reflection */}
            <path
              d="M 32 52 L 136 36 L 32 120 Z"
              fill="url(#splash-glass-grad)"
            />

            {/* TV Stand Stem */}
            <path
              d="M 100 138 L 100 157"
              stroke="url(#splash-gold-grad)"
              strokeWidth="7"
              strokeLinecap="round"
            />

            {/* TV Stand Base */}
            <path
              d="M 64 158 C 64 158 82 156 100 156 C 118 156 136 158 136 158"
              stroke="url(#splash-gold-grad)"
              strokeWidth="7"
              strokeLinecap="round"
            />

            {/* "Seen It !" Validation Stamp Halo Burst */}
            {animate && (
              <circle
                cx="100"
                cy="86"
                r="36"
                fill="none"
                stroke="#F5C518"
                strokeWidth="3"
                className="anim-stamp-burst"
              />
            )}

            {/* "Seen It !" Golden Verification Checkmark Core */}
            <g className={animate ? "anim-seen-check" : ""}>
              {/* Checkmark Depth Shadow Glow (Optimized) */}
              <path
                d="M 75 87 L 93 104 L 127 67"
                fill="none"
                stroke="#F5C518"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.15"
              />
              {/* Solid Golden Checkmark */}
              <path
                d="M 75 87 L 93 104 L 127 67"
                fill="none"
                stroke="url(#splash-check-grad)"
                strokeWidth="11"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Golden Apex Dot */}
              <circle
                cx="127"
                cy="67"
                r="3.5"
                fill="#FFFFFF"
                opacity="0.85"
              />
            </g>

          </svg>
        </div>

        {/* Brand Kinetic Typography */}
        <div className={`flex items-center overflow-hidden py-1 ${animate ? 'anim-title' : ''}`}>
          <span className="text-4xl font-black tracking-tight text-white font-sans">
            Seen
          </span>
          <span className="text-4xl font-black tracking-tight bg-gradient-to-r from-[#FFF4D0] via-[#F5C518] to-[#E5A93D] bg-clip-text text-transparent ml-[2px] font-sans">
            It
          </span>
        </div>

        {/* Subtitle Tagline */}
        <p className={`text-[11px] uppercase font-semibold text-zinc-400 mt-2 text-center ${animate ? 'anim-subtitle' : 'opacity-70 tracking-[0.18em]'}`}>
          L'expérience cinéma & séries
        </p>
      </div>

      {/* 3. Ambient Micro-Loader Bar */}
      {animate && (
        <div className="absolute bottom-12 w-28 h-[2px] bg-white/5 rounded-full overflow-hidden">
          <div className="anim-loader-bar w-full h-full bg-gradient-to-r from-transparent via-[#F5C518] to-transparent" />
        </div>
      )}
    </div>
  );
}
