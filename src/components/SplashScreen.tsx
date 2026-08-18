import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  isReady: boolean;
  minimumDisplayTime?: number;
}

export function SplashScreen({ 
  onComplete, 
  isReady, 
  minimumDisplayTime = 1600,
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
      const closeTimer = setTimeout(() => {
        onComplete();
      }, 400);
      return () => clearTimeout(closeTimer);
    }
  }, [timeElapsed, isReady, isClosing, onComplete]);

  if (minimumDisplayTime === 0 && isReady && !isClosing) {
    // We don't return null anymore, because we want the fade out transition
    // Actually, we just let it render with opacity-0
  }

  return (
    <div
      className={`fixed inset-0 z-[999] bg-[#040406] flex flex-col items-center justify-center overflow-hidden select-none transition-all duration-400 ease-out ${
        isClosing ? 'opacity-0 scale-[1.04] pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{ willChange: 'opacity, transform' }}
    >
      {/* Inline Hardware-Accelerated CSS Animations (Zero JS Thread Overhead / 120 FPS Guaranteed) */}
      {animate && (
        <style>{`
          @keyframes tvStroke {
            0% {
              stroke-dashoffset: 280;
              opacity: 0;
            }
            15% {
              opacity: 1;
            }
            100% {
              stroke-dashoffset: 0;
              opacity: 1;
            }
          }

          @keyframes playPop {
            0% {
              transform: scale(0.1) rotate(-15deg);
              opacity: 0;
            }
            70% {
              transform: scale(1.15) rotate(0deg);
              opacity: 1;
            }
            100% {
              transform: scale(1) rotate(0deg);
              opacity: 1;
            }
          }

          @keyframes shineSweep {
            0% {
              transform: translateX(-80px);
              opacity: 0;
            }
            20% {
              opacity: 0.9;
            }
            80% {
              opacity: 0.9;
            }
            100% {
              transform: translateX(120px);
              opacity: 0;
            }
          }

          @keyframes pulseShockwave {
            0% {
              transform: scale(0.4);
              opacity: 0.8;
            }
            100% {
              transform: scale(2.2);
              opacity: 0;
            }
          }

          @keyframes ambientGlow {
            0% {
              transform: scale(0.8);
              opacity: 0.15;
            }
            50% {
              transform: scale(1.15);
              opacity: 0.4;
            }
            100% {
              transform: scale(1);
              opacity: 0.3;
            }
          }

          @keyframes laserLine {
            0% {
              transform: scaleX(0);
              opacity: 0;
            }
            40% {
              transform: scaleX(1.4);
              opacity: 0.8;
            }
            100% {
              transform: scaleX(0);
              opacity: 0;
            }
          }

          @keyframes textRevealSeen {
            0% {
              transform: translateY(18px);
              opacity: 0;
            }
            100% {
              transform: translateY(0);
              opacity: 1;
            }
          }

          @keyframes textRevealIt {
            0% {
              transform: translateY(18px) scale(0.8);
              opacity: 0;
            }
            70% {
              transform: translateY(-2px) scale(1.1);
              opacity: 1;
            }
            100% {
              transform: translateY(0) scale(1);
              opacity: 1;
            }
          }

          @keyframes subtitleFade {
            0% {
              transform: translateY(6px);
              opacity: 0;
              letter-spacing: 0.25em;
            }
            100% {
              transform: translateY(0);
              opacity: 0.7;
              letter-spacing: 0.15em;
            }
          }

          @keyframes loaderBar {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }

          .anim-ambient-glow {
            animation: ambientGlow 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            will-change: transform, opacity;
          }

          .anim-laser-line {
            animation: laserLine 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
            will-change: transform, opacity;
          }

          .anim-tv-stroke {
            stroke-dasharray: 280;
            stroke-dashoffset: 280;
            animation: tvStroke 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.05s forwards;
            will-change: stroke-dashoffset, opacity;
          }

          .anim-stand-neck {
            stroke-dasharray: 30;
            stroke-dashoffset: 30;
            animation: tvStroke 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards;
            will-change: stroke-dashoffset, opacity;
          }

          .anim-stand-base {
            stroke-dasharray: 50;
            stroke-dashoffset: 50;
            animation: tvStroke 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.48s forwards;
            will-change: stroke-dashoffset, opacity;
          }

          .anim-play-pop {
            transform-origin: 52px 43px;
            animation: playPop 0.55s cubic-bezier(0.34, 1.35, 0.64, 1) 0.52s forwards;
            opacity: 0;
            /* Removed will-change to prevent rasterization blur on scaling SVG paths */
          }

          .anim-shockwave {
            animation: pulseShockwave 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.55s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-shine {
            animation: shineSweep 0.75s cubic-bezier(0.25, 1, 0.5, 1) 0.65s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-text-seen {
            animation: textRevealSeen 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.65s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-text-it {
            animation: textRevealIt 0.55s cubic-bezier(0.34, 1.3, 0.64, 1) 0.75s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-subtitle {
            animation: subtitleFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.88s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-loader {
            animation: loaderBar 1.1s ease-in-out infinite 0.2s;
            will-change: transform;
          }
        `}</style>
      )}

      {/* 1. Cinematic Ambient Backlight Bloom (GPU Composited) */}
      <div 
        className={`${animate ? 'anim-ambient-glow' : 'opacity-30 scale-100'} absolute w-[380px] h-[380px] rounded-full pointer-events-none`}
        style={{
          background: 'radial-gradient(circle, rgba(229,169,61,0.28) 0%, rgba(197,126,11,0.08) 45%, transparent 70%)',
          filter: 'blur(50px)',
          transform: 'translateZ(0)'
        }}
      />

      {/* 2. Anamorphic Golden Laser Line Sweep */}
      {animate && (
        <div 
          className="anim-laser-line absolute top-1/2 left-0 right-0 h-[1.5px] -translate-y-12 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,242,184,0.9) 50%, transparent 100%)',
            transform: 'translateZ(0)'
          }}
        />
      )}

      {/* 3. Main Centered Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        
        {/* SVG TV & Core Graphic */}
        <div className="relative w-28 h-28 flex items-center justify-center mb-4">
          
          {/* Expanding Shockwave Ring on Play Trigger */}
          {animate && <div className="anim-shockwave absolute w-20 h-20 rounded-full border border-[#F5C518]/50 pointer-events-none" />}

          <svg
            width="112"
            height="112"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="overflow-visible"
            style={{ transform: 'translateZ(0)' }}
          >
            <defs>
              {/* Luxury Gold Gradient */}
              <linearGradient id="gpu-gold" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFF5D1" />
                <stop offset="30%" stopColor="#F5C518" />
                <stop offset="70%" stopColor="#E5A93D" />
                <stop offset="100%" stopColor="#B37812" />
              </linearGradient>

              {/* Play Triangle Core Gradient */}
              <linearGradient id="gpu-play" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="30%" stopColor="#FFE899" />
                <stop offset="75%" stopColor="#F5C518" />
                <stop offset="100%" stopColor="#C47E0B" />
              </linearGradient>

              {/* Laser Shimmer Light */}
              <linearGradient id="gpu-shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>

              {/* Clip path inside TV Screen for the laser reflection */}
              <clipPath id="tv-inner-clip">
                <rect x="14" y="17" width="72" height="52" rx="10" />
              </clipPath>
            </defs>

            {/* TV Screen Chassis (Stroke Drawing) */}
            <rect
              x="14"
              y="17"
              width="72"
              height="52"
              rx="10"
              fill="#0B0B0F"
              stroke="url(#gpu-gold)"
              strokeWidth="3.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={animate ? "anim-tv-stroke" : ""}
            />

            {/* Stand Neck */}
            <path
              d="M 50 69 L 50 78.5"
              stroke="url(#gpu-gold)"
              strokeWidth="3.6"
              strokeLinecap="round"
              className={animate ? "anim-stand-neck" : ""}
            />

            {/* Stand Base */}
            <path
              d="M 32 79 C 32 79 41 78 50 78 C 59 78 68 79 68 79"
              stroke="url(#gpu-gold)"
              strokeWidth="3.6"
              strokeLinecap="round"
              className={animate ? "anim-stand-base" : ""}
            />

            {/* Screen Glass Reflection Corner */}
            <path
              d="M 16 26 L 68 18 L 16 60 Z"
              fill="#FFFFFF"
              fillOpacity="0.08"
            />

            {/* Play Button High-Contrast Core */}
            <path
              d="M 43 32.5 C 43 31.2 44.4 30.4 45.5 31.1 L 63 41.6 C 64 42.2 64 43.8 63 44.4 L 45.5 54.9 C 44.4 55.6 43 54.8 43 53.5 Z"
              fill="url(#gpu-play)"
              className={animate ? "anim-play-pop" : ""}
            />

            {/* Laser Shimmer Sweep across screen */}
            {animate && (
              <g clipPath="url(#tv-inner-clip)">
                <line
                  x1="8"
                  y1="10"
                  x2="25"
                  y2="80"
                  stroke="url(#gpu-shimmer)"
                  strokeWidth="14"
                  className="anim-shine"
                />
              </g>
            )}
          </svg>
        </div>

        {/* 4. Brand Kinetic Typography */}
        <div className="flex items-center overflow-hidden py-1">
          <span className={`${animate ? 'anim-text-seen' : ''} text-4xl font-black tracking-tight text-white font-sans`}>
            Seen
          </span>
          <span className={`${animate ? 'anim-text-it' : ''} text-4xl font-black tracking-tight bg-gradient-to-r from-[#FFF4C2] via-[#F5C518] to-[#E5A93D] bg-clip-text text-transparent ml-[2px] font-sans`}>
            It
          </span>
        </div>

        {/* 5. Subtitle Tagline */}
        <p className={`${animate ? 'anim-subtitle' : 'opacity-70 tracking-[0.15em]'} text-[11px] uppercase font-semibold text-zinc-400 mt-2 text-center`}>
          L'expérience cinéma & séries
        </p>
      </div>

      {/* 6. Ambient Loading Line */}
      {animate && (
        <div className="absolute bottom-12 w-32 h-[2px] bg-white/5 rounded-full overflow-hidden">
          <div className="anim-loader w-full h-full bg-gradient-to-r from-transparent via-[#E5A93D] to-transparent" />
        </div>
      )}
    </div>
  );
}
