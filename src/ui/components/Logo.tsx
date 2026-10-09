/**
 * The BugTrail mark: a simple bug with an S-shaped "trail" seam.
 * Colour comes from `--bt-brand`, so it follows the theme. The seam and the
 * head/body gap are cut out with a mask, so it works on any background.
 */
export function LogoMark({ size = 20, title }: { size?: number; title?: string }) {
  const id = 'bt-logo-cut';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
          <rect width="128" height="128" fill="#fff" />
          <ellipse cx="64" cy="80" rx="27" ry="35" fill="none" stroke="#000" strokeWidth="5" />
          <path
            d="M64 50 C 56 62, 72 74, 64 86 C 58 95, 68 104, 64 112"
            fill="none"
            stroke="#000"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <g mask={`url(#${id})`} fill="var(--bt-brand)" stroke="var(--bt-brand)" strokeLinecap="round">
        <path
          d="M42 60 L26 50 M86 60 L102 50 M38 80 L20 80 M90 80 L108 80 M42 100 L26 110 M86 100 L102 110"
          fill="none"
          strokeWidth="7"
        />
        <path d="M58 30 C 55 22, 51 18, 45 16 M70 30 C 73 22, 77 18, 83 16" fill="none" strokeWidth="6" />
        <circle cx="64" cy="38" r="12.5" stroke="none" />
        <ellipse cx="64" cy="80" rx="27" ry="35" stroke="none" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      Bug<span className="wordmark-trail">Trail</span>
    </span>
  );
}
