import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  isReady: boolean;
  minimumDisplayTime?: number;
  animate?: boolean;
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

  return (
    <div
      id="seenit-splash-screen"
      className={`fixed inset-0 z-[999] bg-[#040406] flex flex-col items-center justify-center overflow-hidden select-none transition-all duration-400 ease-out ${
        isClosing ? 'opacity-0 scale-[1.03] pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{ willChange: 'opacity, transform', transform: 'translate3d(0, 0, 0)' }}
    >
      {/* High-Performance 120 FPS GPU Keyframes */}
      {animate && (
        <style>{`
          @keyframes tvStrokeDraw {
            0% {
              stroke-dashoffset: 560;
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

          @keyframes standDraw {
            0% {
              stroke-dashoffset: 120;
              opacity: 0;
            }
            100% {
              stroke-dashoffset: 0;
              opacity: 1;
            }
          }

          @keyframes playPopElastic {
            0% {
              transform: scale(0.2) translate3d(0, 0, 0);
              opacity: 0;
            }
            65% {
              transform: scale(1.12) translate3d(0, 0, 0);
              opacity: 1;
            }
            85% {
              transform: scale(0.96) translate3d(0, 0, 0);
              opacity: 1;
            }
            100% {
              transform: scale(1) translate3d(0, 0, 0);
              opacity: 1;
            }
          }

          @keyframes sweepGlint {
            0% {
              transform: translateX(-160px) translate3d(0, 0, 0);
              opacity: 0;
            }
            20% {
              opacity: 0.85;
            }
            80% {
              opacity: 0.85;
            }
            100% {
              transform: translateX(240px) translate3d(0, 0, 0);
              opacity: 0;
            }
          }

          @keyframes pulseShockwave {
            0% {
              transform: scale(0.5) translate3d(0, 0, 0);
              opacity: 0.8;
            }
            100% {
              transform: scale(2.4) translate3d(0, 0, 0);
              opacity: 0;
            }
          }

          @keyframes ambientBacklight {
            0% {
              transform: scale(0.7) translate3d(0, 0, 0);
              opacity: 0.15;
            }
            50% {
              transform: scale(1.1) translate3d(0, 0, 0);
              opacity: 0.45;
            }
            100% {
              transform: scale(1) translate3d(0, 0, 0);
              opacity: 0.3;
            }
          }

          @keyframes laserFlare {
            0% {
              transform: scaleX(0) translate3d(0, 0, 0);
              opacity: 0;
            }
            40% {
              transform: scaleX(1.3) translate3d(0, 0, 0);
              opacity: 0.85;
            }
            100% {
              transform: scaleX(0) translate3d(0, 0, 0);
              opacity: 0;
            }
          }

          @keyframes titleRevealSeen {
            0% {
              transform: translateY(16px) translate3d(0, 0, 0);
              opacity: 0;
            }
            100% {
              transform: translateY(0) translate3d(0, 0, 0);
              opacity: 1;
            }
          }

          @keyframes titleRevealIt {
            0% {
              transform: translateY(16px) scale(0.85) translate3d(0, 0, 0);
              opacity: 0;
            }
            70% {
              transform: translateY(-2px) scale(1.08) translate3d(0, 0, 0);
              opacity: 1;
            }
            100% {
              transform: translateY(0) scale(1) translate3d(0, 0, 0);
              opacity: 1;
            }
          }

          @keyframes subtitleFadeIn {
            0% {
              transform: translateY(6px) translate3d(0, 0, 0);
              opacity: 0;
              letter-spacing: 0.25em;
            }
            100% {
              transform: translateY(0) translate3d(0, 0, 0);
              opacity: 0.75;
              letter-spacing: 0.16em;
            }
          }

          @keyframes loaderBarAnim {
            0% { transform: translateX(-100%) translate3d(0, 0, 0); }
            100% { transform: translateX(100%) translate3d(0, 0, 0); }
          }

          .anim-ambient-glow {
            animation: ambientBacklight 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            will-change: transform, opacity;
          }

          .anim-laser-flare {
            animation: laserFlare 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
            will-change: transform, opacity;
          }

          .anim-tv-frame {
            stroke-dasharray: 560;
            stroke-dashoffset: 560;
            animation: tvStrokeDraw 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.05s forwards;
            will-change: stroke-dashoffset, opacity;
          }

          .anim-stand-stem {
            stroke-dasharray: 60;
            stroke-dashoffset: 60;
            animation: standDraw 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.38s forwards;
            will-change: stroke-dashoffset, opacity;
          }

          .anim-stand-foot {
            stroke-dasharray: 100;
            stroke-dashoffset: 100;
            animation: standDraw 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.44s forwards;
            will-change: stroke-dashoffset, opacity;
          }

          .anim-play-pop-group {
            transform-origin: 106px 86px;
            animation: playPopElastic 0.6s cubic-bezier(0.34, 1.4, 0.64, 1) 0.48s forwards;
            opacity: 0;
          }

          .anim-shockwave-ring {
            animation: pulseShockwave 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.52s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-glint-sweep {
            animation: sweepGlint 0.75s cubic-bezier(0.25, 1, 0.5, 1) 0.62s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-title-seen {
            animation: titleRevealSeen 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.62s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-title-it {
            animation: titleRevealIt 0.55s cubic-bezier(0.34, 1.3, 0.64, 1) 0.72s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-tagline {
            animation: subtitleFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.84s forwards;
            opacity: 0;
            will-change: transform, opacity;
          }

          .anim-bottom-loader {
            animation: loaderBarAnim 1.1s ease-in-out infinite 0.2s;
            will-change: transform;
          }
        `}</style>
      )}

      {/* 1. Cinematic Ambient Backlight Bloom (GPU Composited) */}
      <div 
        className={`${animate ? 'anim-ambient-glow' : 'opacity-30 scale-100'} absolute w-[360px] h-[360px] rounded-full pointer-events-none`}
        style={{
          background: 'radial-gradient(circle, rgba(245,197,24,0.24) 0%, rgba(217,119,6,0.08) 50%, transparent 70%)',
          filter: 'blur(45px)',
          transform: 'translate3d(0, 0, 0)'
        }}
      />

      {/* 2. Anamorphic Golden Laser Line Sweep */}
      {animate && (
        <div 
          className="anim-laser-flare absolute top-1/2 left-0 right-0 h-[1.5px] -translate-y-12 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,244,194,0.95) 50%, transparent 100%)',
            transform: 'translate3d(0, 0, 0)'
          }}
        />
      )}

      {/* 3. Main Centered Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        
        {/* SVG TV & Core Graphic */}
        <div className="relative w-32 h-32 flex items-center justify-center mb-4">
          
          {/* Expanding Shockwave Ring on Play Trigger */}
          {animate && <div className="anim-shockwave-ring absolute w-24 h-24 rounded-full border border-[#F5C518]/60 pointer-events-none" />}

          <svg
            width="128"
            height="128"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            shapeRendering="geometricPrecision"
            className="overflow-visible"
            style={{ transform: 'translate3d(0, 0, 0)' }}
          >
            <defs>
              {/* Premium Multi-Stop Metallic Gold */}
              <linearGradient id="splash-gold-chassis" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFDF0" />
                <stop offset="25%" stopColor="#FDE68A" />
                <stop offset="55%" stopColor="#F5C518" />
                <stop offset="85%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#92400E" />
              </linearGradient>

              {/* Crisp Play Core Gradient */}
              <linearGradient id="splash-play-core" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="35%" stopColor="#FEF08A" />
                <stop offset="75%" stopColor="#F5C518" />
                <stop offset="100%" stopColor="#D97706" />
              </linearGradient>

              {/* Laser Shimmer Light */}
              <linearGradient id="splash-shimmer-sweep" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>

              {/* High-Resolution Screen Clip */}
              <clipPath id="splash-screen-clip">
                <rect x="28" y="34" width="144" height="104" rx="20" />
              </clipPath>
            </defs>

            {/* TV Screen Chassis (Smooth Vector Frame) */}
            <rect
              x="28"
              y="34"
              width="144"
              height="104"
              rx="20"
              fill="#08080C"
              stroke="url(#splash-gold-chassis)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={animate ? "anim-tv-frame" : ""}
            />

            {/* Stand Neck / Stem */}
            <path
              d="M 100 138 L 100 157"
              stroke="url(#splash-gold-chassis)"
              strokeWidth="7"
              strokeLinecap="round"
              className={animate ? "anim-stand-stem" : ""}
            />

            {/* Stand Base */}
            <path
              d="M 64 158 C 64 158 82 156 100 156 C 118 156 136 158 136 158"
              stroke="url(#splash-gold-chassis)"
              strokeWidth="7"
              strokeLinecap="round"
              className={animate ? "anim-stand-foot" : ""}
            />

            {/* Screen Glass Reflection Corner */}
            <path
              d="M 32 52 L 136 36 L 32 120 Z"
              fill="#FFFFFF"
              fillOpacity="0.06"
            />

            {/* Play Button - Crisp Group Transform (Zero Rasterization Blur) */}
            <g className={animate ? "anim-play-pop-group" : ""}>
              {/* Subtle Backing Glow */}
              <path
                d="M 86 64.5 C 86 62 88.8 60.5 91 61.8 L 126 83.3 C 128.2 84.6 128.2 87.8 126 89.1 L 91 110.6 C 88.8 111.9 86 110.4 86 107.9 Z"
                fill="#F5C518"
                fillOpacity="0.25"
                transform="scale(1.08)"
                style={{ transformOrigin: '106px 86px' }}
              />
              {/* Solid High-Resolution Vector Triangle */}
              <path
                d="M 86 64.5 C 86 62 88.8 60.5 91 61.8 L 126 83.3 C 128.2 84.6 128.2 87.8 126 89.1 L 91 110.6 C 88.8 111.9 86 110.4 86 107.9 Z"
                fill="url(#splash-play-core)"
              />
            </g>

            {/* Laser Shimmer Sweep across screen */}
            {animate && (
              <g clipPath="url(#splash-screen-clip)">
                <line
                  x1="16"
                  y1="20"
                  x2="50"
                  y2="160"
                  stroke="url(#splash-shimmer-sweep)"
                  strokeWidth="28"
                  className="anim-glint-sweep"
                />
              </g>
            )}
          </svg>
        </div>

        {/* 4. Brand Kinetic Typography */}
        <div className="flex items-center overflow-hidden py-1">
          <span className={`${animate ? 'anim-title-seen' : ''} text-4xl font-black tracking-tight text-white font-sans`}>
            Seen
          </span>
          <span className={`${animate ? 'anim-title-it' : ''} text-4xl font-black tracking-tight bg-gradient-to-r from-[#FFFDF0] via-[#F5C518] to-[#D97706] bg-clip-text text-transparent ml-[2px] font-sans`}>
            It
          </span>
        </div>

        {/* 5. Subtitle Tagline */}
        <p className={`${animate ? 'anim-tagline' : 'opacity-75 tracking-[0.16em]'} text-[11px] uppercase font-semibold text-zinc-400 mt-2 text-center`}>
          L'expérience cinéma & séries
        </p>
      </div>

      {/* 6. Ambient Loading Line */}
      {animate && (
        <div className="absolute bottom-12 w-32 h-[2px] bg-white/5 rounded-full overflow-hidden">
          <div className="anim-bottom-loader w-full h-full bg-gradient-to-r from-transparent via-[#F5C518] to-transparent" />
        </div>
      )}
    </div>
  );
}
