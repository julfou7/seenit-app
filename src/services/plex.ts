export const getPlexClientId = () => {
  let clientId = localStorage.getItem('plex_client_identifier');
  if (!clientId) {
    clientId = 'tv-time-app-' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('plex_client_identifier', clientId);
  }
  return clientId;
};

export const getPlexPin = async () => {
  const clientId = getPlexClientId();
  const response = await fetch('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: {
      'X-Plex-Client-Identifier': clientId,
      'X-Plex-Product': 'TV Time Sync',
      'X-Plex-Version': '1.0.0',
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
