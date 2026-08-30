import { CURRENT_APP_VERSION } from '../store/updateStore';

export const getPlexClientId = () => {
  let clientId = localStorage.getItem('plex_client_identifier');
  const isUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
  if (!isUuid) {
    clientId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
          const random = (Math.random() * 16) | 0;
          const value = character === 'x' ? random : (random & 0x3) | 0x8;
          return value.toString(16);
        });
    localStorage.setItem('plex_client_identifier', clientId);
  }
  return clientId!;
};

export const getPlexPin = async () => {
  const clientId = getPlexClientId();
  const response = await fetch('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: {
      'X-Plex-Client-Identifier': clientId,
      'X-Plex-Product': 'SeenIt',
      'X-Plex-Version': CURRENT_APP_VERSION,
      'X-Plex-Platform': 'Web',
      'Accept': 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error('Erreur lors de la création du code PIN Plex');
  }
  return response.json();
};

export const checkPlexPin = async (pinId: number) => {
  const clientId = getPlexClientId();
  const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
    method: 'GET',
    headers: {
      'X-Plex-Client-Identifier': clientId,
      'Accept': 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error('Erreur lors de la vérification du code PIN Plex');
  }
  return response.json();
};
