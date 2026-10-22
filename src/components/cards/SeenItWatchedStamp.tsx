import './seenItWatchedStamp.css';

export function SeenItWatchedStamp({ className = '' }: { className?: string }) {
  return <span className={`seenit-watched-stamp ${className}`} aria-hidden="true">
    <svg viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="38" stroke="rgba(229,169,61,.3)" strokeWidth="11" /><circle cx="50" cy="50" r="38" stroke="#E5A93D" strokeWidth="11" strokeLinecap="round" strokeDasharray="196 239" transform="rotate(-90 50 50)" /><path d="M36 51 L46 61 L65 40" stroke="#F2C36B" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /></svg>VU
  </span>;
}
