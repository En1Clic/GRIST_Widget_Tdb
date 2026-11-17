#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fabrique demo/actions-demo.json, le jeu de demonstration du widget (mode ?demo ou page ouverte
hors de Grist), au format normalise que renvoie src/source.js pour une vraie table : dates en
'AAAA-MM-JJ', references en libelles, couleurs et ordre des referentiels dans `meta`, colonnes
calculees (DATE_FIN_EFF, CHAMPS_MANQUANTS) precalculees.

Donnees 100 % fictives et generiques, generees ici sans aucune source externe.

Usage :
    python outils/generer_demo.py [nombre] [graine] [sortie]
    (defauts : 80 actions, graine 2026, demo/actions-demo.json)
"""

import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ENTITES = ["Agence Nord", "Agence Sud", "Agence Est", "Agence Ouest", "Agence Centre",
           "Direction Alpha", "Direction Beta", "Direction Gamma", "Pôle Innovation",
           "Pôle Services", "Pôle Territoires", "Antenne Littoral", "Antenne Montagne",
           "Siège", "Filiale A", "Filiale B"]
CATEGORIES = ["Campagne", "Partenariat", "Événement", "Presse", "Publication", "Étude",
              "Site web", "Autre"]
THEMES = ["Innovation", "Formation", "Qualité", "Territoires", "Numérique", "Services",
          "Partenariats", "Patrimoine", "Recrutement", "Prévention", "Autres"]
DEMANDEURS = ["Direction générale", "Direction A", "Direction B", "Direction C",
              "Secrétariat général", "Communication", "Autres"]
STATUTS = ["Confirmé", "Prévu"]
CANAUX = ["Réseaux sociaux", "Presse", "Affichage", "Radio", "Newsletter", "Vidéo",
          "Événementiel", "Site internet"]
MODELES = {
    "Campagne": ["Campagne {t}", "Campagne d'information {t}"],
    "Partenariat": ["Partenariat {t}", "Convention {t}"],
    "Événement": ["Journée {t}", "Rencontre {t}", "Salon {t}"],
    "Presse": ["Conférence de presse {t}", "Voyage de presse {t}"],
    "Publication": ["Guide {t}", "Rapport {t}", "Brochure {t}"],
    "Étude": ["Étude {t}", "Enquête {t}"],
    "Site web": ["Refonte du site {t}", "Mini-site {t}"],
    "Autre": ["Projet {t}", "Opération {t}"],
}
REQUIS = {"Campagne": ["DEMANDEUR", "DATE_FIN"], "Partenariat": ["DATE_FIN"], "Étude": ["MONTANT"]}

# Palette de démonstration (le widget applique par défaut sa propre palette douce).
PALETTE = ["#2f7f6f", "#5b9bc4", "#8cbf8a", "#2c5f7c", "#6fb3a8", "#a9c7de", "#4f8a4b", "#c9b98a"]


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
    sortie = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent.parent / "demo" / "actions-demo.json"

    debut0 = date(2026, 1, 1)
    rows = []
    for i in range(1, n + 1):
        cat = rnd.choices(CATEGORIES, weights=[10, 7, 16, 15, 11, 5, 5, 11])[0]
        theme = rnd.choice(THEMES)
        d = debut0 + timedelta(days=rnd.randint(0, 440))
        duree = rnd.choice([0, 0, 1, 3, 7, 14, 30, 45, 60, 90, 120])
        fin = None if rnd.random() < 0.12 else d + timedelta(days=duree)
        if i % 37 == 0 and fin:                       # cas de recette : fin avant début
            fin = d - timedelta(days=5)
        demandeur = "" if rnd.random() < 0.08 else rnd.choice(DEMANDEURS)
        montant = rnd.choice([0, 0, 1500, 4200, 9800, 18000, 35000, 64000, 120000, 250000, 410000])
        row = {
            "id": i,
            "ENTITE": rnd.choice(ENTITES),
            "INTITULE": rnd.choice(MODELES[cat]).format(t=theme.lower()),
            "CATEGORIE": cat,
            "THEME": theme,
            "DEMANDEUR": demandeur,
            "STATUT": rnd.choice(STATUTS),
            "CANAUX": rnd.sample(CANAUX, rnd.randint(1, 4)),
            "DATE_DEBUT": d.isoformat(),
            "DATE_FIN": fin.isoformat() if fin else None,
            "MONTANT": montant,
        }
        row["DATE_FIN_EFF"] = row["DATE_FIN"] or row["DATE_DEBUT"]
        row["CHAMPS_MANQUANTS"] = ", ".join(c for c in REQUIS.get(cat, []) if not row.get(c))
        rows.append(row)

    columns = [
        ("ENTITE", "Entité", "Ref:Entites", "category"),
        ("INTITULE", "Intitulé", "Text", "text"),
        ("CATEGORIE", "Catégorie", "Ref:Categories", "category"),
        ("THEME", "Thème", "Ref:Themes", "category"),
        ("DEMANDEUR", "Demandeur", "Ref:Demandeurs", "category"),
        ("STATUT", "Statut", "Choice", "category"),
        ("CANAUX", "Canaux", "ChoiceList", "list"),
        ("DATE_DEBUT", "Date de début", "Date", "date"),
        ("DATE_FIN", "Date de fin", "Date", "date"),
        ("DATE_FIN_EFF", "Date de fin effective", "Date", "date"),
        ("MONTANT", "Montant", "Numeric", "number"),
        ("CHAMPS_MANQUANTS", "Champs à compléter", "Text", "text"),
    ]
    meta = {
        "CATEGORIE": {"colors": {c: PALETTE[i % len(PALETTE)] for i, c in enumerate(CATEGORIES)},
                      "order": {c: i + 1 for i, c in enumerate(CATEGORIES)}},
        "ENTITE": {"colors": {}, "order": {}},
        "THEME": {"colors": {}, "order": {}},
        "DEMANDEUR": {"colors": {}, "order": {}},
        "STATUT": {"colors": {}, "order": {s: i for i, s in enumerate(STATUTS)}},
    }
    data = {"table": "Actions",
            "columns": [{"id": c, "label": l, "type": t, "kind": k} for c, l, t, k in columns],
            "rows": rows, "meta": meta}
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} actions fictives -> {sortie}")


if __name__ == "__main__":
    main()
