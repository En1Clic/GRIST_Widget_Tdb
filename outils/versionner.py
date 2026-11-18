#!/usr/bin/env python3
"""Pose un numero de version sur toutes les ressources du widget, pour que les navigateurs
rechargent le code apres chaque publication (GitHub Pages impose 10 min de cache).

Reecrit, avec ?v=<version> :
  - dans index.html : les feuilles de style et scripts locaux (src/, vendor/) ;
  - dans src/*.js   : les imports relatifs ('./x.js') ;
  - dans src/source.js : l'URL du jeu de demonstration.
index.html charge lui-meme l'application : seul ce fichier n'est pas versionne, et Grist le
recharge a chaque ouverture de page (il est leger).

Usage : python outils/versionner.py [version]   (defaut : date et heure, ex. 20261117-1530)
A lancer avant chaque commit publie.
"""
import re
import sys
from datetime import datetime
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
V = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y%m%d-%H%M")
SUFFIXE = re.compile(r"\?v=[\w.-]+")


def poser(m):
    return SUFFIXE.sub("", m.group(1)) + "?v=" + V + m.group(2)


n = 0
# Pages d'entrée : tableau de bord (index.html) et widget de saisie (saisie/index.html).
for html in (RACINE / "index.html", RACINE / "saisie" / "index.html"):
    t = html.read_text(encoding="utf-8")
    t2 = re.sub(r'((?:href|src)="(?:\.\./)?(?:src/|vendor/|saisie\.)[^"?]+(?:\?v=[\w.-]+)?)(")', poser, t)
    n += t2 != t
    html.write_text(t2, encoding="utf-8")

for f in [*(RACINE / "src").glob("*.js"), *(RACINE / "saisie").glob("*.js")]:
    t = f.read_text(encoding="utf-8")
    t2 = re.sub(r"""((?:from|import)\s*\(?\s*'\.\.?/[^'?]+\.js(?:\?v=[\w.-]+)?)(')""", poser, t)
    t2 = re.sub(r"""(fetch\('(?:\.\./)?demo/[^'?]+\.json(?:\?v=[\w.-]+)?)(')""", poser, t2)
    if t2 != t:
        f.write_text(t2, encoding="utf-8")
        n += 1
print(f"version {V} posee ({n} fichiers modifies)")
