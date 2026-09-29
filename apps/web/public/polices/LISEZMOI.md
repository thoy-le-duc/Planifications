# Polices hébergées avec l'appli

Toutes sous licence SIL Open Font License 1.1 (fichiers `OFL-*.txt` à côté). Sous-ensemble
latin, woff2, tirées de Fontsource 5.3.0 (npm, jamais en dépendance).

| Fichier | Origine |
| --- | --- |
| `atkinson-hyperlegible-latin-400.woff2`, `-700` | Fontsource, tel quel |
| `ibm-plex-mono-latin-500.woff2`, `-600` | Fontsource, tel quel |
| `archivo-latin-112-wght.woff2` | woff2 variable latin de `@fontsource-variable/archivo` (axes `wght` et `wdth`, 88 Kio ; ici avant T16 sous le nom `archivo-latin-wdth-wght.woff2`), réduit : 22 Kio |

## Archivo : comment le fichier est fabriqué

Les titres n'emploient Archivo qu'à 112 % de largeur, en graisses 700 et 800. On fige l'axe de
largeur à 112 (plus d'axe `wdth`, `OS/2.usWidthClass` = 6), on restreint la graisse à 600–800,
puis on refait le sous-ensemble latin (mêmes plages que le `unicode-range` de `src/ui/base.css`).

```sh
python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
/tmp/ft/bin/fonttools varLib.instancer archivo-latin-wdth-wght.woff2 \
  wdth=112 wght=600:800 -o archivo-112.ttf
/tmp/ft/bin/pyftsubset archivo-112.ttf --flavor=woff2 \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" \
  --output-file=archivo-latin-112-wght.woff2
rm -rf /tmp/ft archivo-112.ttf
```

Vérifié par `src/ui/polices.test.ts` (≤ 30 Kio, pas d'axe `wdth`, `usWidthClass` 6, `wght`
600 à 800).

## Licence

La licence d'Archivo (`OFL-archivo.txt`) ne déclare aucun nom réservé (« Reserved Font Name ») :
la version modifiée peut garder le nom Archivo (OFL, article 3). Elle reste sous OFL, licence
jointe (article 5).
