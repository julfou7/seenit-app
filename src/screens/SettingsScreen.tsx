import { SettingsScreen as SettingsScreenCore } from './SettingsScreenCore';

/** Réglages en cinq lignes : chaque ligne ouvre son écran, dont la fonctionnalité Téléchargements (Application). */
export function SettingsScreen({ onClose }: { onClose?: () => void }) {
  return <SettingsScreenCore onClose={onClose} />;
}
