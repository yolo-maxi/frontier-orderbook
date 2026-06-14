/** DarkBox mark — an isometric box/cube, the "box" the order flow lives in. */
export function DarkBoxMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="rgba(35,224,200,0.08)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" stroke="rgba(35,224,200,0.35)" />
      <path
        d="M16 5.5 25.5 11v10L16 26.5 6.5 21V11Z"
        fill="none"
        stroke="var(--db-accent, #23e0c8)"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M16 5.5V16l9.5-5M16 16 6.5 11M16 16v10.5"
        stroke="var(--db-accent, #23e0c8)"
        strokeWidth="1.2"
        opacity="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ markSize = 22 }: { markSize?: number }) {
  return (
    <span className="brand">
      <DarkBoxMark size={markSize} />
      <span className="brand-word">DARKBOX</span>
      <span className="brand-tag">ARC</span>
    </span>
  );
}
