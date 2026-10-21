// TasteProbe mark: a tasting glass, part-filled, with the dashed pour line of an interval.
export function LogoMark({ size = 30, ring = "currentColor", dot = "#ff6ec7" }: { size?: number; ring?: string; dot?: string }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <path d="M10.6 17.4h10.8l-.5 3.6c-.2 1.2-1 1.9-2.2 1.9h-5.4c-1.2 0-2-.7-2.2-1.9z" fill={dot} />
    <path d="M9 4.5h14l-2.1 16.6c-.2 1.2-1 1.9-2.2 1.9h-5.4c-1.2 0-2-.7-2.2-1.9z" stroke={ring} strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M7.5 13.6h17" stroke={dot} strokeWidth="1.6" strokeDasharray="2 2" />
    <path d="M16 23v4.6M11 28h10" stroke={ring} strokeWidth="2.2" strokeLinecap="round" />
  </svg>;
}

export function Logo({ href, ring, dot, className = "" }: { href?: string; ring?: string; dot?: string; className?: string }) {
  const body = <><LogoMark ring={ring} dot={dot} /><span>TasteProbe</span></>;
  return href ? <a className={`brand ${className}`} href={href} aria-label="TasteProbe home">{body}</a> : <span className={`brand ${className}`}>{body}</span>;
}
