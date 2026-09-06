export interface UpdateProgress {
  percent: number;
  status: 'idle' | 'downloading' | 'installing' | 'error' | 'done';
  message: string;
}

export interface UpdateProgressPresentation {
  label: string;
  tone: 'progress' | 'success' | 'error';
}

export function getUpdateProgressPresentation(progress: Pick<UpdateProgress, 'status'>): UpdateProgressPresentation {
  switch (progress.status) {
    case 'downloading':
      return { label: 'Téléchargement...', tone: 'progress' };
    case 'installing':
      return { label: 'Ouverture de l’installeur...', tone: 'progress' };
    case 'done':
      return { label: 'Installeur lancé', tone: 'success' };
    case 'error':
      return { label: 'Erreur', tone: 'error' };
    default:
      return { label: 'Prêt', tone: 'progress' };
  }
}
