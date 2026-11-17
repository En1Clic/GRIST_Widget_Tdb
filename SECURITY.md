# Sécurité du widget

## Ce que le widget voit : uniquement ce que l'utilisateur connecté a le droit de voir

Le widget est une page web chargée par le **navigateur de l'utilisateur**, dans la page Grist qu'il consulte. Il ne parle jamais directement au serveur Grist : chaque lecture (`docApi.fetchTable`, tables méta, options) est relayée par la page Grist de l'utilisateur, donc par **sa session et ses droits**. Les règles d'accès du document s'appliquent donc au widget exactement comme aux tableaux, fiches et graphiques natifs (documentation Grist : *Custom widgets* — « subject to Access Rules » ; *Access rules* — les données ouvertes ou fermées par les règles valent aussi « within … custom widgets »).

Exemple avec des règles d'accès par entité :

| Profil | Ce que montre le tableau de bord |
|---|---|
| Contributeur d'une entité | les seules actions de son entité ; les indicateurs, graphiques, Gantt et tableaux sont calculés sur ces lignes (ex. « Entités avec au moins une action » = 1) |
| Profil de lecture globale, administrateur | toutes les actions |
| Utilisateur sans rattachement | aucune action (tableau de bord vide) |

Le widget ne lit pas les tables résumées de Grist (souvent réservées aux profils de lecture globale) : il recalcule ses agrégats à partir des lignes que l'utilisateur voit, ce qui évite toute fuite par agrégat. Si un référentiel est illisible pour un profil, les références s'affichent par leur identifiant au lieu de leur libellé ; rien d'autre n'est exposé.

« Accès complet au document » est le niveau de **capacité** accordé au widget (lire toutes les tables, pas seulement la table liée) ; il ne lève aucune règle d'accès. Le widget n'écrit jamais dans les données ; seule sa configuration (table source, rôles des colonnes, palette, filtres affichés) est enregistrée dans les options de la vue, ce que seuls les utilisateurs autorisés à modifier la structure peuvent faire.

**Contrôle de recette** : ouvrir la page du widget avec « Voir en tant que » pour chaque profil et vérifier que le badge d'en-tête (`Grist · Actions · N lignes`) et les indicateurs correspondent aux lignes visibles dans la table d'actions pour ce même profil.

## Pourquoi le code peut être public

Le dépôt ne contient ni secret, ni clé, ni donnée réelle (le jeu de démonstration est fictif). Le code est exécuté dans le navigateur, comme le JavaScript de n'importe quel site : le lire ne donne accès à rien. Les widgets officiels de Grist suivent le même modèle (code public servi par GitHub Pages).

Le risque à maîtriser est l'**intégrité** : une modification malveillante du code pourrait, elle, lire ce que voit l'utilisateur et l'envoyer ailleurs. D'où :

- écriture sur le dépôt réservée au compte de développement EN 1 CLIC ;
- branche `main` protégée (pas de poussée par d'autres comptes, pas de réécriture forcée, pas de suppression) ;
- double authentification obligatoire ;
- aucune ressource externe chargée et politique de sécurité de contenu embarquée dans `index.html` (`default-src 'self'`, `connect-src 'self'`) : la page publiée ne peut ni charger de script tiers ni envoyer de données hors de son propre domaine ;
- toute évolution passe par un commit identifié ; l'historique du dépôt est le journal des versions.

## Signaler un problème

Contacter EN 1 CLIC. Ne pas ouvrir de ticket public décrivant une faille avant correction.
