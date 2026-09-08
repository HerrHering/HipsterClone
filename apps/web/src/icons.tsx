// Hand-authored inline SVG icons — no icon library dependency, consistent
// with this codebase's existing minimal-deps philosophy (no state-management
// library, no WebSocket library, etc.). Each renders a small Feather/
// Lucide-style line icon; `stroke="currentColor"` means every icon inherits
// whatever color its containing element already has (a badge, a button, a
// heading), so there's no separate light/dark handling needed, unlike the
// one real bitmap asset this app has (favicon.svg) or the invert() filter
// hack index.css needs for a raster image.

interface IconProps {
  size?: number;
  className?: string;
}

function baseProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function IconMusic({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function IconMic({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

export function IconCoin({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 15.5c0 1 1 1.5 2.5 1.5s2.5-.6 2.5-1.6-1-1.4-2.5-1.7-2.5-.7-2.5-1.7S10.5 10.5 12 10.5s2.5.5 2.5 1.5" />
    </svg>
  );
}

export function IconCrown({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M3 8l4 4 5-7 5 7 4-4-2 10H5z" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function IconCheck({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconX({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function IconLogOut({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function IconUsers({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
