import type { ProviderId } from '../data/shippingCatalog';

interface ProviderLogoProps {
  providerId: ProviderId | string;
  className?: string;
}

export function ProviderLogo({ providerId, className = 'h-10 w-24' }: ProviderLogoProps) {
  switch (providerId) {
    case 'ups':
      return (
        <div className={`inline-flex items-center gap-2.5 ${className}`} aria-label="UPS Logo">
          <svg viewBox="0 0 36 42" className="w-8 h-9 shrink-0" fill="none">
            <path
              d="M18 2L33 7.5V22.2C33 31.1 26.2 37.5 18 40C9.8 37.5 3 31.1 3 22.2V7.5L18 2Z"
              fill="#351C15"
              stroke="#FFB500"
              strokeWidth="2.2"
            />
            <path d="M5.5 11.5C13 8.8 23 8.8 30.5 11.5" stroke="#FFB500" strokeWidth="2" />
            <text
              x="18"
              y="26"
              textAnchor="middle"
              fill="#FFB500"
              fontSize="11"
              fontWeight="800"
              fontFamily="Plus Jakarta Sans, sans-serif"
            >
              UPS
            </text>
          </svg>
        </div>
      );

    case 'fedex':
      return (
        <div className={`inline-flex items-center ${className}`} aria-label="FedEx Logo">
          <span className="font-display text-2xl font-extrabold tracking-tight leading-none select-none">
            <span className="text-[#4D148C] dark:text-[#9F67FF]">Fed</span>
            <span className="text-[#FF6600]">Ex</span>
          </span>
        </div>
      );

    case 'usps':
      return (
        <div className={`inline-flex items-center gap-2 ${className}`} aria-label="USPS Logo">
          <svg viewBox="0 0 40 28" className="w-9 h-7 shrink-0" fill="none">
            <rect x="1" y="2" width="38" height="24" rx="4" fill="#004B87" />
            <path d="M8 20L17 8H33L26 15H17L13 20H8Z" fill="#FFFFFF" />
            <path d="M6 22H34" stroke="#DA291C" strokeWidth="2.2" />
          </svg>
          <span className="font-display text-sm font-bold tracking-wide text-slate-900 dark:text-white">
            USPS
          </span>
        </div>
      );

    case 'royal-mail':
      return (
        <div className={`inline-flex items-center gap-2 ${className}`} aria-label="Royal Mail Logo">
          <svg viewBox="0 0 36 28" className="w-8 h-7 shrink-0" fill="none">
            <rect x="1" y="2" width="34" height="24" rx="4" fill="#D5002B" />
            <path d="M10 17L12 10L18 13L24 10L26 17H10Z" fill="#FFCC00" />
            <rect x="10" y="18.5" width="16" height="2" fill="#FFFFFF" />
          </svg>
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">
            Royal Mail
          </span>
        </div>
      );

    case 'shipstation':
      return (
        <div className={`inline-flex items-center gap-2 ${className}`} aria-label="ShipStation Logo">
          <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="6" fill="#78B833" />
            <path d="M9 17L16 10L23 17H19V23H13V17H9Z" fill="#FFFFFF" />
          </svg>
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">
            ShipStation
          </span>
        </div>
      );

    case 'easypost':
      return (
        <div className={`inline-flex items-center gap-2 ${className}`} aria-label="EasyPost Logo">
          <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="6" fill="#0B5FFF" />
            <path d="M8 12L16 7L24 12V20L16 25L8 20V12Z" stroke="#FFFFFF" strokeWidth="2" />
            <path d="M12 16L15 19L21 13" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">
            EasyPost
          </span>
        </div>
      );

    case 'easyship':
      return (
        <div className={`inline-flex items-center gap-2 ${className}`} aria-label="EasyShip Logo">
          <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="6" fill="#00A7E1" />
            <path d="M7 18C11 13 21 13 25 18" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M10 21H22L24 15H8L10 21Z" fill="#FFFFFF" fillOpacity="0.25" stroke="#FFFFFF" strokeWidth="1.6" />
          </svg>
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">
            EasyShip
          </span>
        </div>
      );

    case 'stamps':
    default:
      return (
        <div className={`inline-flex items-center gap-2 ${className}`} aria-label="Stamps.com Logo">
          <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="6" fill="#1E3A8A" />
            <rect x="7" y="8" width="18" height="16" rx="2" stroke="#FFFFFF" strokeWidth="1.8" strokeDasharray="2 2" />
            <path d="M11 16H21M16 11V21" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">
            Stamps.com
          </span>
        </div>
      );
  }
}
