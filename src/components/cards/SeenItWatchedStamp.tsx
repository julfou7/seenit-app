import { SeenItRing } from '../SeenItLogo';
import './seenItWatchedStamp.css';
export function SeenItWatchedStamp({ className = '', screen: _screen = false }: { className?: string; screen?: boolean }) {
 return <span className={'seenit-watched-stamp '+className} aria-hidden="true"><SeenItRing size={42}/>VU</span>;
}
