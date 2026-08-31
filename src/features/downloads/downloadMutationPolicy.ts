/**
 * Les mutations distantes ne sont exécutées qu'une fois. Un timeout peut survenir
 * après l'application côté serveur : seul un contrôle utilisateur peut autoriser
 * une nouvelle tentative avec une nouvelle clé d'idempotence.
 */
export async function executeDownloadMutationOnce<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}
