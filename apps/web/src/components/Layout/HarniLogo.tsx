import React from 'react';

export interface HarniLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textClassName?: string;
}

/**
 * Harni Brand Logo
 * Features a modern stylized 'H' combining twin code pillars
 * harmonized by a central AI quantum spark core.
 */
export const HarniLogo: React.FC<HarniLogoProps> = ({
  size = 32,
  className = '',
  showText = false,
  textClassName = '',
}) => {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div
        className="relative flex items-center justify-center shrink-0 rounded-xl overflow-hidden shadow-soft select-none transition-transform duration-200 hover:scale-105"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
          aria-label="harni logo"
        >
          <defs>
            {/* Ambient Background Gradient (Morandi Indigo to Soft Violet) */}
            <linearGradient id="harni-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4F46E5" />
              <stop offset="50%" stopColor="#6366F1" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>

            {/* Spark & Energy Gradient */}
            <linearGradient id="harni-spark-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="60%" stopColor="#E0E7FF" />
              <stop offset="100%" stopColor="#38BDF8" />
            </linearGradient>

            {/* Pillar Gradient */}
            <linearGradient id="harni-pillar-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#E0E7FF" stopOpacity="0.82" />
            </linearGradient>

            {/* Core Glow Filter */}
            <filter id="harni-core-glow" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Squircle Badge Background */}
          <rect width="32" height="32" rx="9" fill="url(#harni-bg-grad)" />

          {/* Inner Specular Highlight Rim */}
          <rect
            x="0.75"
            y="0.75"
            width="30.5"
            height="30.5"
            rx="8.25"
            stroke="white"
            strokeOpacity="0.22"
            strokeWidth="0.75"
          />

          {/* Subtle Top-Lighting Sheen */}
          <ellipse cx="16" cy="3" rx="11" ry="3.5" fill="white" fillOpacity="0.16" />

          {/* Left Code Pillar */}
          <rect
            x="8"
            y="7"
            width="3.25"
            height="18"
            rx="1.6"
            fill="url(#harni-pillar-grad)"
          />

          {/* Right Code Pillar */}
          <rect
            x="20.75"
            y="7"
            width="3.25"
            height="18"
            rx="1.6"
            fill="url(#harni-pillar-grad)"
          />

          {/* Connecting Crossbar */}
          <path
            d="M 10 16 H 22"
            stroke="url(#harni-spark-grad)"
            strokeWidth="2.75"
            strokeLinecap="round"
          />

          {/* Central AI Quantum Spark (Harmonious Intelligence Center) */}
          <path
            d="M 16 10.5 Q 16 16 20.5 16 Q 16 16 16 21.5 Q 16 16 11.5 16 Q 16 16 16 10.5 Z"
            fill="url(#harni-spark-grad)"
            filter="url(#harni-core-glow)"
          />

          {/* Core Spark Pinpoint */}
          <circle cx="16" cy="16" r="1.1" fill="#FFFFFF" />
        </svg>
      </div>

      {showText && (
        <span
          className={`font-bold tracking-tight text-ag-textPrimary select-none ${
            textClassName || 'text-base'
          }`}
        >
          harni
        </span>
      )}
    </div>
  );
};
