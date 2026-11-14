import { readFileSync } from 'node:fs';

/**
 * Convention #497 pour les TNR documentaires : un simple reflow Markdown (retour à la ligne,
 * indentation de continuation, CRLF) ne doit pas faire échouer un contrat. Le texte est ramené à
 * des espaces simples ; les mots, leur ordre et la ponctuation restent strictement vérifiés.
 * À ne pas utiliser lorsqu'une assertion porte réellement sur la structure en lignes (`^`, `\n`, tableau).
 */
export function normalizeDocText(text: string): string {
  return text.replace(/\s+/g, ' ');
}

export function readDocText(path: string): string {
  return normalizeDocText(readFileSync(path, 'utf8'));
}
