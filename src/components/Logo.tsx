// TasteProbe mark: a probe dot inside a ring.
export function LogoMark({ size = 30, ring = "currentColor", dot = "var(--accent)" }: { size?: number; ring?: string; dot?: string }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="12.5" stroke={ring} strokeWidth="3" />
    <circle cx="16" cy="16" r="5.5" stroke={ring} strokeOpacity=".32" strokeWidth="1.5" strokeDasharray="2 2.6" />
    <circle cx="19.4" cy="12.6" r="4.2" fill={dot} />
  </svg>;
}

export function Logo({ href, ring, dot, className = "" }: { href?: string; ring?: string; dot?: string; className?: string }) {
  const body = <><LogoMark ring={ring} dot={dot} /><span>TasteProbe</span></>;
  return href ? <a className={`brand ${className}`} href={href} aria-label="TasteProbe home">{body}</a> : <span className={`brand ${className}`}>{body}</span>;
}
