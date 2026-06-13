/** The "frontier line" — a stepped tick-ladder glyph. */
export function FrontierMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="rgba(240,185,11,0.08)" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="6.5"
        stroke="rgba(240,185,11,0.35)"
      />
      <path
        d="M7 23.5h4.5V18H16v-5.5h4.5V8H25"
        stroke="#f0b90b"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ markSize = 22, href }: { markSize?: number; href?: string }) {
  const inner = (
    <>
      <FrontierMark size={markSize} />
      <span className="brand-word">FRONTIER</span>
      <span className="brand-tag">CLOB</span>
    </>
  );
  if (href) {
    return (
      <a className="brand" href={href} title="Back to overview">
        {inner}
      </a>
    );
  }
  return <span className="brand">{inner}</span>;
}
