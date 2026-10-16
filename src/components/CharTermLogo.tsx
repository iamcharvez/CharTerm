type CharTermLogoProps = {
  size?: number;
  className?: string;
};

export function CharTermLogo({ size = 44, className }: CharTermLogoProps) {
  return (
    <svg
      aria-label="CharTerm logo"
      className={className}
      height={size}
      role="img"
      viewBox="0 0 64 64"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="charterm-mark" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67E8F9" />
          <stop offset="0.48" stopColor="#06B6D4" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
        <filter id="charterm-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#charterm-mark)" />
      <rect x="6" y="6" width="52" height="52" rx="15" fill="#071019" fillOpacity=".9" />
      <path d="M19 22.5 28.5 32 19 41.5" fill="none" stroke="url(#charterm-mark)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" filter="url(#charterm-glow)" />
      <path d="M33 42h12" fill="none" stroke="#E6FBFF" strokeWidth="5" strokeLinecap="round" />
      <circle cx="49" cy="17" r="3" fill="#67E8F9" />
    </svg>
  );
}

