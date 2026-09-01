/**
 * Marque une chaîne comme texte purement présentational.
 *
 * L'ajout ou le déplacement d'un appel reste une modification complète. Une fois le marqueur en
 * place, seule la valeur littérale peut évoluer via le parcours light ; aucune URL, clé, route,
 * identité technique ou valeur pilotant la logique ne doit être enveloppée ici.
 */
export const uiCopy = <Value extends string>(value: Value): Value => value;
