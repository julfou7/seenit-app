const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'docs/specifications/android-contract.json');
const googleServicesPath = path.join(root, 'android/app/google-services.json');
const gradlewPath = path.join(root, 'android/gradlew');

function materializeAndroidConfig() {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const firebase = contract.firebase || {};
  const required = [
    'projectId', 'androidPackageName', 'androidMobileSdkAppId', 'projectNumber',
    'storageBucket', 'activeAndroidOauthClientId', 'activeAndroidCertificateHash',
    'webOauthClientId', 'apiKey'
  ];
  for (const key of required) {
    if (!firebase[key]) throw new Error(`Contrat Firebase Android incomplet : ${key}`);
  }
  if (!Array.isArray(firebase.androidOauthClients) || firebase.androidOauthClients.length < 2) {
    throw new Error('Contrat Firebase Android incomplet : clients OAuth Android historique et actif attendus.');
  }
  for (const client of firebase.androidOauthClients) {
    if (!client?.clientId || !/^[a-f0-9]{40}$/i.test(client?.certificateHash || '')) {
      throw new Error('Contrat Firebase Android invalide : client OAuth Android incomplet.');
    }
  }
  const activeClient = firebase.androidOauthClients.find(client =>
    client.clientId === firebase.activeAndroidOauthClientId
    && client.certificateHash === firebase.activeAndroidCertificateHash
  );
  if (!activeClient) {
    throw new Error('Contrat Firebase Android invalide : le client OAuth actif ne correspond pas à la signature active.');
  }

  const googleServices = {
    project_info: {
      project_number: String(firebase.projectNumber),
      project_id: String(firebase.projectId),
      storage_bucket: String(firebase.storageBucket)
    },
    client: [{
      client_info: {
        mobilesdk_app_id: String(firebase.androidMobileSdkAppId),
        android_client_info: { package_name: String(firebase.androidPackageName) }
      },
      oauth_client: [
        ...firebase.androidOauthClients.map(client => ({
          client_id: String(client.clientId),
          client_type: 1,
          android_info: {
            package_name: String(firebase.androidPackageName),
            certificate_hash: String(client.certificateHash)
          }
        })),
        { client_id: String(firebase.webOauthClientId), client_type: 3 }
      ],
      api_key: [{ current_key: String(firebase.apiKey) }],
      services: {
        appinvite_service: {
          other_platform_oauth_client: [
            { client_id: String(firebase.webOauthClientId), client_type: 3 }
          ]
        }
      }
    }],
    configuration_version: '1'
  };

  fs.mkdirSync(path.dirname(googleServicesPath), { recursive: true });
  fs.writeFileSync(googleServicesPath, `${JSON.stringify(googleServices, null, 2)}\n`, 'utf8');
  if (fs.existsSync(gradlewPath) && process.platform !== 'win32') {
    fs.chmodSync(gradlewPath, 0o755);
  }
  return { googleServicesPath, gradlewPath };
}

if (require.main === module) {
  materializeAndroidConfig();
  console.log('[Android Config] google-services.json matérialisé et gradlew normalisé.');
}

module.exports = { materializeAndroidConfig };
