# Traçabilité des demandes SeenIt

Le registre conserve les décisions durables exprimées par le propriétaire du produit afin qu'elles
survivent aux conversations et aux changements d'agent. Il ne remplace ni la SPEC ni les issues.

## Règle de classement

- Une règle durable de produit, UX, données, sécurité, PWA, APK ou développement est inscrite dans
  [`registry.md`](./registry.md) et reliée à une ou plusieurs exigences de la SPEC.
- Si la règle est absente, la même livraison modifie la SPEC, `requirements.json` et un test précis.
- Si son implémentation est différée, une issue GitHub priorisée est liée au registre.
- Un log, une hypothèse de diagnostic, une question, une demande de statut ou une préférence
  ponctuelle n'est pas transformé artificiellement en exigence.
- Aucun jeton, URL privée, UID, secret ou donnée personnelle n'est recopié dans le registre.

## Statuts

- `active` : règle actuelle à respecter ;
- `superseded` : remplacée par une décision ultérieure, avec lien vers celle-ci ;
- `retired` : abandonnée explicitement, avec justification.

Une ligne n'est jamais supprimée pour masquer une évolution : son statut et ses liens sont mis à jour.
