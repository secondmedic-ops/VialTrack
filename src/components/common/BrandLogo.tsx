import React from 'react';

interface BrandLogoProps {
  className?: string;
  variant?: 'color' | 'white' | 'dark';
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  subtitle?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = 'h-8 w-auto',
  variant = 'color',
  showText = true,
  size = 'md',
  subtitle
}) => {
  const iconSizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
    xl: 'w-12 h-12'
  };

  const textClasses = {
    sm: 'text-xs',
    md: 'text-sm sm:text-base',
    lg: 'text-base sm:text-lg',
    xl: 'text-xl sm:text-2xl'
  };

  const isWhite = variant === 'white';

  return (
    <div className={`inline-flex items-center gap-2 select-none shrink-0 ${className}`}>
      {/* Official SecondMedic Speech-Bubble with ECG Heartbeat in Cyan/Teal to Blue Gradient */}
      <svg
        viewBox="0 0 100 100"
        className={`${iconSizeClasses[size]} shrink-0`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="smBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00D084" />
            <stop offset="100%" stopColor="#0080FF" />
          </linearGradient>
          <linearGradient id="smHeartbeatGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00D084" />
            <stop offset="100%" stopColor="#0080FF" />
          </linearGradient>
        </defs>

        {/* Speech-Bubble Circular Outline */}
        <path
          d="M 50 10 C 27.9 10 10 27.9 10 50 C 10 58.2 12.5 65.8 16.8 72.1 L 12 90 L 30.5 85.6 C 36.3 88.4 43 90 50 90 C 72.1 90 90 72.1 90 50 C 90 27.9 72.1 10 50 10 Z"
          stroke="url(#smBrandGrad)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={isWhite ? 'transparent' : 'rgba(0, 208, 132, 0.05)'}
        />

        {/* Dynamic ECG Heartbeat Wave */}
        <path
          d="M 24 50 H 38 L 44 26 L 56 74 L 63 38 L 68 56 L 73 50 H 78"
          stroke={isWhite ? '#FFFFFF' : 'url(#smBrandGrad)'}
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Vital node pulse dot */}
        <circle cx="44" cy="26" r="3.5" fill="#00D084" />
        <circle cx="56" cy="74" r="3.5" fill="#0080FF" />
      </svg>

      {/* Crisp Brand Typography */}
      {showText && (
        <div className="flex flex-col justify-center leading-tight">
          <div className={`font-black tracking-tight ${textClasses[size]} ${isWhite ? 'text-white' : 'text-slate-900'}`}>
            <span>Second</span>
            <span className="bg-gradient-to-r from-[#00D084] to-[#0080FF] bg-clip-text text-transparent">
              Medic
            </span>
          </div>
          {subtitle && (
            <span className={`text-[9px] font-bold uppercase tracking-widest leading-none ${isWhite ? 'text-slate-200' : 'text-slate-500'}`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
