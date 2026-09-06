export async function createServer(): Promise<never> {
  throw new Error('Le serveur Vite de développement ne doit pas être initialisé depuis le bundle backend de production.');
}
