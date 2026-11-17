# Widget Grist — Tableau de bord d'actions (KPI filtrables)

Widget personnalisé Grist, en HTML/JS statique, qui se branche sur une table d'actions (une ligne = une action datée, rattachée à une entité, une catégorie, un thème…) et affiche des indicateurs, des graphiques, un Gantt et des tableaux de synthèse **qui dépendent de filtres** : année, catégorie, entité, thème…, et clic sur un graphique pour filtrer tous les autres.

Quatre onglets ; les filtres sont communs à tous et restent actifs d'un onglet à l'autre :

| Onglet | Contenu |
|---|---|
| **Vue d'ensemble** | Nombre d'actions, entités actives, budget total, actions à compléter ; actions et budget par catégorie ; actions par mois × catégorie ; répartitions par thème, demandeur, statut |
| **Par entité** | Actions, budget, budget moyen, durée moyenne ; actions et budget par entité ; catégories par entité ; liste des actions (recherche, tri, pagination) |
| **Planning** | Gantt : une barre par action (début → fin effective), regroupement repliable par entité / catégorie / thème / demandeur, échelle Tout / 12 / 6 / 3 mois, trait « aujourd'hui », info-bulle, légende cliquable, dates incohérentes signalées |
| **Tableaux** | Tables de synthèse recalculées et filtrables : vision annuelle par catégorie (nombre, budget, part, première date de début, dernière date de fin, ordre), par entité, par thème, détail mensuel en carte de chaleur (nombre ou budget) |

Les intitulés affichés reprennent les libellés des colonnes du document : le widget s'adapte au vocabulaire de chaque table.

Présentation : en-tête et barre de filtres fixes (seul le contenu défile, chaque onglet garde sa position), barre repliable en une ligne de filtres actifs, choix des filtres affichés dans ⚙. Palette douce bleus/verts par défaut (ou couleurs des référentiels du document, au choix dans ⚙), fond en courbes de niveau (`src/fond.svg`, local), cartes en verre dépoli avec relief, thème clair/sombre.

Seule la **mécanique de branchement à Grist** est reprise d'Advanced Charts (ANUPRESS, MIT) ; l'écran est neuf. Pas d'éditeur, pas d'impression/PDF, pas de cartes, pas de tableaux de bord multiples.

## Garanties de conception

- **Aucune écriture dans les données** : le widget lit les tables, il n'appelle jamais `applyUserActions`. Seule sa configuration (table source, rôle des colonnes, palette, filtres affichés) est enregistrée, dans les options de la vue (`kpiConfig`).
- **Respect des règles d'accès** : chaque utilisateur ne voit que les lignes que les règles du document lui ouvrent (voir `SECURITY.md`).
- **Aucune dépendance réseau** : ECharts et `grist-plugin-api.js` sont embarqués dans `vendor/` à version figée. Aucune police, image ou script externe.
- **Politique de sécurité embarquée** (`<meta http-equiv="Content-Security-Policy">` dans `index.html`) : `default-src 'self'`, rien ne peut être chargé ni envoyé hors du domaine du widget. Les échanges avec Grist passent par `postMessage`.
- **Accès demandé : complet.** Il sert à lire les référentiels (libellés, couleurs, ordre) et le schéma (`_grist_Tables_column`). Voir « Accès minimal » plus bas pour l'alternative.

## Arborescence

```
index.html                 page d'entrée (CSP, chargement des bibliothèques)
src/grist-bridge.js        pont Grist : poignée de main, schéma, lignes, dates, options  ← dérivé d'Advanced Charts
src/source.js              jeu normalisé : références -> libellés, couleurs/ordre des référentiels, mode démo
src/model.js               rôles des colonnes, filtres croisés, agrégats (fonctions pures)
src/charts.js              options ECharts (barres, colonnes empilées, anneaux), palette douce
src/gantt.js               onglet Planning (Gantt HTML/CSS, sans bibliothèque)
src/tables.js              onglet Tableaux (tables de synthèse, carte de chaleur)
src/dom.js                 utilitaires DOM partagés
src/app.js                 écran : en-tête, filtres, onglets, liste, réglages
src/styles.css             thème clair/sombre, relief, mise en page fixe
src/fond.svg               fond en courbes de niveau
vendor/                    echarts.min.js 5.6.0, grist-plugin-api.js (grist-core)
demo/actions-demo.json     80 actions fictives et génériques (mode démonstration)
outils/generer_demo.py     régénère le jeu de démonstration (aucune source externe)
outils/serveur_dev.py      serveur local sans cache (python outils/serveur_dev.py → http://localhost:4180/)
tests/source.test.mjs      test du branchement avec un faux hôte Grist (node tests/source.test.mjs)
tests/essai-reel.mjs       même pont sur un vrai document, en lecture seule (clé par GRIST_API_KEY)
```

## Comment le widget se branche à une table

1. **Poignée de main** (`connect`) : `grist.ready({requiredAccess:'full'})`, puis on attend un message de l'hôte. Sans réponse en 4 s, ou page ouverte hors iframe, ou `?demo` dans l'URL → mode démonstration.
2. **Schéma** : lecture de `_grist_Tables` et `_grist_Tables_column` → type réel, libellé, table cible et colonne visible de chaque référence.
3. **Lignes** : `docApi.fetchTable(table)` ; puis un seul appel par référentiel ciblé pour traduire les identifiants en libellés. Si le référentiel a une colonne `Couleur` (hex) ou `Ordre`, elles colorent et ordonnent les graphiques ; pour une colonne `Choice`, ce sont les couleurs et l'ordre des choix.
4. **Rôles** : chaque rôle (entité, catégorie, thème, demandeur, statut, dates, montant, intitulé, champs à compléter) est attribué automatiquement d'après l'identifiant et le libellé des colonnes, modifiable dans ⚙ Réglages, et enregistré dans les options du widget. Par défaut la table `Actions` est lue si elle existe, sinon la première table ; une autre table se choisit dans ⚙.
5. **Rafraîchissement** : `grist.onRecords` sur la table liée relance la lecture quand une ligne change ; bouton ↻ pour forcer.

## Installer dans Grist

1. Publication : GitHub Pages sur ce dépôt (branche `main`, racine) → `https://en1clic.github.io/GRIST_Widget_Tdb/index.html`.
2. Dans le document : *Ajouter une vue* → *Personnalisé* → la table d'actions → *URL personnalisée* : l'URL ci-dessus.
3. Panneau de droite : niveau d'accès **Accès complet au document**.

Essai local : `python outils/serveur_dev.py`, puis `http://localhost:4180/` (démonstration). Sur le même PC, un document Grist peut afficher le widget par l'URL `http://localhost:4180/index.html` (Chrome peut demander l'autorisation d'accès au réseau local).

## Accès minimal (piste)

Pour passer en accès « lecture de la table » : remplacer la lecture du schéma et des référentiels par `grist.onRecords(…, {expandRefs: true})` et le mapping de colonnes de `grist.ready({columns: […]})`. Les libellés des références viennent alors de l'expansion ; les couleurs, de colonnes formules ajoutées à la table.

## Licences

Code EN 1 CLIC sous licence MIT (`LICENSE`). `src/grist-bridge.js` est dérivé d'Advanced Charts (© 2026 ANUPRESS, MIT) ; les bibliothèques de `vendor/` sont sous Apache-2.0. Voir `THIRD-PARTY-NOTICES.md`.
