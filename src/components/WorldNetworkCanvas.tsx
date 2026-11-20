import { useEffect, useState } from 'react';

interface HubNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

const HUBS: HubNode[] = [
  { id: 'nyc', label: 'New York', x: 255, y: 150 },
  { id: 'tex', label: 'Dallas', x: 185, y: 175 },
  { id: 'tor', label: 'Toronto', x: 238, y: 132 },
  { id: 'lon', label: 'London', x: 452, y: 118 },
  { id: 'fra', label: 'Frankfurt', x: 488, y: 126 },
  { id: 'mad', label: 'Madrid', x: 446, y: 154 },
  { id: 'osl', label: 'Oslo', x: 486, y: 86 },
  { id: 'syd', label: 'Sydney', x: 825, y: 318 },
];

const ROUTES: [string, string][] = [
  ['nyc', 'lon'],
  ['nyc', 'fra'],
  ['tor', 'lon'],
  ['tex', 'nyc'],
  ['lon', 'fra'],
  ['lon', 'mad'],
  ['fra', 'osl'],
  ['fra', 'syd'],
];

function arcPath(a: HubNode, b: HubNode): string {
  const mx = (a.x + b.x) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const my = (a.y + b.y) / 2 - Math.min(85, dist * 0.25);
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

export function WorldNetworkCanvas() {
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const timer = setInterval(() => {
      setActiveRouteIdx((prev) => (prev + 1) % ROUTES.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  const hubMap = new Map(HUBS.map((h) => [h.id, h]));

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-950 via-[#0c1e3e] to-[#0a2558] p-5 flex flex-col justify-between min-h-[320px]">
      <div className="flex items-center justify-between text-xs text-blue-200/90">
        <span className="font-display font-semibold tracking-tight text-white">
          Global Verified Account Provisioning Network
        </span>
        <span className="font-mono tabular-nums text-blue-300">
          14 Core Countries · 3 Account Tiers
        </span>
      </div>

      <div className="relative flex-1 flex items-center justify-center my-2">
        <svg
          viewBox="0 0 960 400"
          className="w-full h-auto max-h-[290px]"
          role="img"
          aria-label="World map showing verified global account provisioning hubs"
        >
          <defs>
            <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.35" />
            </linearGradient>
            <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Subtle latitude/longitude grid */}
          {[80, 160, 240, 320].map((y) => (
            <line key={y} x1="20" y1={y} x2="940" y2={y} stroke="#1e3a8a" strokeOpacity="0.35" strokeWidth="1" />
          ))}
          {[160, 320, 480, 640, 800].map((x) => (
            <line key={x} x1={x} y1="20" x2={x} y2="380" stroke="#1e3a8a" strokeOpacity="0.35" strokeWidth="1" />
          ))}

          {/* Stylized continent silhouettes */}
          <g fill="#172f5f" stroke="#2563eb" strokeOpacity="0.45" strokeWidth="1.2">
            {/* North America */}
            <path d="M95,95 L185,78 L275,95 L292,135 L252,175 L215,205 L185,220 L152,190 L118,150 Z" />
            {/* South America */}
            <path d="M235,232 L288,245 L312,295 L285,362 L248,370 L232,305 Z" />
            {/* Europe */}
            <path d="M420,92 L495,72 L542,95 L535,148 L475,165 L428,152 Z" />
            {/* Africa */}
            <path d="M432,178 L518,175 L558,228 L525,318 L478,332 L442,265 Z" />
            {/* Asia */}
            <path d="M552,85 L715,75 L805,120 L780,198 L685,228 L595,212 L555,155 Z" />
            {/* Australia */}
            <path d="M755,275 L848,268 L875,325 L825,355 L758,332 Z" />
          </g>

          {/* Animated Network Arcs */}
          {ROUTES.map(([fromId, toId], idx) => {
            const a = hubMap.get(fromId);
            const b = hubMap.get(toId);
            if (!a || !b) return null;
            const d = arcPath(a, b);
            const isHighlighted = idx === activeRouteIdx;
            return (
              <g key={`${fromId}-${toId}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={isHighlighted ? '#38bdf8' : 'url(#routeGrad)'}
                  strokeWidth={isHighlighted ? 2.4 : 1.35}
                  strokeDasharray={isHighlighted ? 'none' : '4 4'}
                  opacity={isHighlighted ? 1 : 0.6}
                />
                {isHighlighted && (
                  <circle r="4.5" fill="#ffffff">
                    <animateMotion dur="2.1s" repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Hub Nodes */}
          {HUBS.map((hub) => (
            <g key={hub.id}>
              <circle cx={hub.x} cy={hub.y} r="13" fill="url(#hubGlow)" />
              <circle cx={hub.x} cy={hub.y} r="4" fill="#60a5fa" stroke="#ffffff" strokeWidth="1.5" />
              <text
                x={hub.x}
                y={hub.y + 16}
                textAnchor="middle"
                fill="#cbd5e1"
                fontSize="10"
                fontFamily="DM Sans, sans-serif"
              >
                {hub.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="pt-3 border-t border-blue-900/60 flex items-center justify-between text-xs text-slate-300">
        <span>Active Verification Hub</span>
        <span className="font-mono text-sky-300">
          {hubMap.get(ROUTES[activeRouteIdx][0])?.label} → {hubMap.get(ROUTES[activeRouteIdx][1])?.label}
        </span>
      </div>
    </div>
  );
}
