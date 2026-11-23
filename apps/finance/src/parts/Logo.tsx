/**
 * The ALETHICAL.AI logo: the Alethical mark and the wordmark with ".AI" in the
 * mark's teal (Design's Alethical.AI landing and investor pages handoff, 23 Nov
 * 2026). The drawn letters are hidden from assistive technology; whoever places
 * the logo gives it its accessible name, so the name is read once.
 */
export function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="8 9 84 84" aria-hidden="true" focusable="false">
      <path d="M8,92 L46,10 L46,92 Z" fill="#5CC2DC" />
      <path d="M92,92 L54,10 L54,92 Z" fill="#5CC2DC" />
    </svg>
  );
}

export function Logo({ markSize = 24, className }: { markSize?: number; className?: string }) {
  return (
    <>
      <LogoMark size={markSize} />
      <span className={className ? `ai-wordmark ${className}` : 'ai-wordmark'} aria-hidden="true">
        ALETHICAL<span className="ai-wordmark-ai">.AI</span>
      </span>
    </>
  );
}
