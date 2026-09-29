#!/usr/bin/env python3
"""Génère la page de suivi de Théophane à partir des fichiers du dépôt.

Usage : python3 docs/suivi/generer.py <sortie.html>
Lit docs/backlog/README.md, docs/questions.md, docs/journal.md et docs/suivi/etat.json
(résumé, tickets en cours, visuels). Les images citées par etat.json sont lues dans docs/suivi/.
Page publiée : https://claude.ai/artifact/GmRGZyPSajnNNHCobAgBpM (voir docs/boucle.md).
"""
import base64, html, json, os, re, sys

ici = os.path.dirname(os.path.abspath(__file__))
racine = os.path.dirname(os.path.dirname(ici))
sortie = sys.argv[1]
etat = json.load(open(os.path.join(ici, 'etat.json'), encoding='utf-8'))
lire = lambda p: open(os.path.join(racine, p), encoding='utf-8').read()
e = html.escape

def md(s):
    s = e(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`(.+?)`', r'<code>\1</code>', s)
    s = re.sub(r'\[(.+?)\]\((?:[^)]+)\)', r'\1', s)
    return s

# --- Tickets ---
tickets = []
for l in lire('docs/backlog/README.md').splitlines():
    m = re.match(r'^\| \[(T\w+)\]\([^)]+\) \| (.+?) \| (.+?) \| (.+?) \|$', l)
    if m:
        t, sujet, dep, statut = m.groups()
        statut = etat.get('en_cours', {}).get(t, statut)
        tickets.append((t, sujet, dep, statut))
faits = sum(1 for t in tickets if t[3] == 'fait')

# --- Décisions ---
decisions = []
qs = lire('docs/questions.md')
for m in re.finditer(r'^### (Q[\w ]+?) — (.+?) \(posée le ([\d-]+)[^)]*\)\n(.*?)(?=^### |^## |\Z)', qs, re.M | re.S):
    q, titre, date, corps = m.groups()
    rep = re.search(r'^Réponse[^:]*: (.+)$', corps, re.M)
    decisions.append((q.strip(), titre, date, rep.group(1) if rep else None))

# --- Journal ---
journal = []
jr = lire('docs/journal.md')
for m in re.finditer(r'^## ([\d-]+) — (.+?)\n(.*?)(?=^## |\Z)', jr, re.M | re.S):
    date, titre, corps = m.groups()
    lignes = dict(re.findall(r'^- \*\*(Fait|Décidé|Bloquant)\*\* : (.+)$', corps, re.M))
    journal.append((date, titre, lignes))

def img(nom):
    p = os.path.join(ici, nom)
    return 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode() if os.path.exists(p) else ''

PILL = {'fait': 'p-fait', 'en revue': 'p-cours', 'en relecture': 'p-cours', 'en cours': 'p-cours', 'à préciser': 'p-attente', 'à valider': 'p-attente', 'à faire': 'p-afaire'}
attente = [d for d in decisions if d[3] is None]

phases = [('0', 'Fondations', 'terminée', 100), ('1', 'Noyau', f'{faits} tickets sur {len(tickets)}', round(100 * faits / max(1, len(tickets)))),
          ('2', 'Voix et agent', 'à venir', 0), ('3', 'Intelligence et intégrations', 'à venir', 0), ('4', 'Fermes pilotes', 'à venir', 0)]

out = []
w = out.append
w(open(os.path.join(ici, 'entete.html'), encoding='utf-8').read())
w(f'<header><span class="eyebrow">Suivi du projet · mis à jour le {e(etat.get("maj", ""))}</span>')
w(f'<h1>Planifications</h1><p class="lead">{md(etat.get("resume", ""))}</p></header>')

w('<section aria-labelledby="h-av"><h2 id="h-av">Avancement</h2><ol class="phases">')
for n, nom, detail, pct in phases:
    w(f'<li class="phase{" active" if 0 < pct < 100 else ""}"><div class="ph-tete"><span class="ph-num">Phase {n}</span><b>{e(nom)}</b></div>'
      f'<div class="barre" role="img" aria-label="{pct} %"><i style="width:{pct}%"></i></div><span class="ph-det">{e(detail)}</span></li>')
w('</ol></section>')

w('<section aria-labelledby="h-att"><h2 id="h-att">Ce qui t\'attend</h2>')
if attente:
    w('<ul class="carte liste">' + ''.join(f'<li><span class="pastille p-attente">{e(q)}</span><span>{md(t)}</span></li>' for q, t, _, _ in attente) + '</ul>')
else:
    w(f'<p class="carte vide">{md(etat.get("attente", "Aucune question en attente. La boucle avance seule."))}</p>')
w('</section>')

w('<section aria-labelledby="h-vis"><h2 id="h-vis">Ce qu\'on peut déjà voir</h2><div class="visuels">')
for v in etat.get('visuels', []):
    imgs = ''.join(f'<img src="{img(i)}" alt="{e(v["alt"])}" loading="lazy">' for i in v.get('images', []) if img(i))
    lien = f'<a href="{e(v["lien"])}">{e(v.get("lien_texte", "Ouvrir"))}</a>' if v.get('lien') else ''
    w(f'<figure class="carte visuel">{"<div class=imgs>" + imgs + "</div>" if imgs else ""}<figcaption><span class="pastille {PILL.get(v["etat"], "p-afaire")}">{e(v["etat"])}</span>'
      f'<b>{e(v["titre"])}</b><span class="muted">{md(v["texte"])}</span>{lien}</figcaption></figure>')
w('</div></section>')

w('<section aria-labelledby="h-t"><h2 id="h-t">Tickets de la phase 1</h2><div class="carte tableau"><table><thead><tr><th>Ticket</th><th>Sujet</th><th>Dépend de</th><th>État</th></tr></thead><tbody>')
for t, s, d, st in tickets:
    w(f'<tr><td class="code">{e(t)}</td><td>{md(s)}</td><td class="code muted">{e(d)}</td><td><span class="pastille {PILL.get(st, "p-afaire")}">{e(st)}</span></td></tr>')
w('</tbody></table></div></section>')

w('<section aria-labelledby="h-d"><h2 id="h-d">Décisions prises</h2><ul class="carte liste decisions">')
for q, t, date, rep in decisions:
    if rep:
        w(f'<li><span class="code q">{e(q)}</span><div><b>{md(t)}</b><span class="muted">{md(rep)}</span></div></li>')
w('</ul></section>')

w('<section aria-labelledby="h-j"><h2 id="h-j">Journal</h2><div class="journal">')
for date, titre, l in journal[:10]:
    w(f'<article class="carte entree"><span class="code muted">{e(date)}</span><h3>{md(titre)}</h3><dl>')
    for k in ('Fait', 'Décidé', 'Bloquant'):
        if k in l: w(f'<dt>{k}</dt><dd>{md(l[k])}</dd>')
    w('</dl></article>')
w('</div></section>')
w('<footer class="muted">Page régénérée par la boucle à chaque fin de session, à partir de <code>docs/backlog</code>, <code>docs/questions.md</code>, <code>docs/journal.md</code> et <code>docs/suivi/etat.json</code>.</footer></div>')
open(sortie, 'w', encoding='utf-8').write('\n'.join(out))
print('ok', len(tickets), 'tickets', faits, 'faits', len(decisions), 'décisions', len(journal), 'entrées')
