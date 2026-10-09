/** Stroke icons (24×24 grid, currentColor). Add new ones here rather than inlining SVG in components. */
const PATHS = {
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  copy: 'M9 9h10v10H9z M5 15V5h10',
  stop: 'M7 7h10v10H7z',
  play: 'M8 5l11 7-11 7z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  sun: 'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5 M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  auto: 'M12 3a9 9 0 1 0 0 18z M12 3a9 9 0 0 1 0 18',
  mute: 'M4 9h4l5-4v14l-5-4H4z M16 9l5 6 M21 9l-5 6',
  unmute: 'M4 9h4l5-4v14l-5-4H4z M17 9a4 4 0 0 1 0 6',
  sidePanel: 'M4 5h16v14H4z M14 5v14',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v10H5z',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
