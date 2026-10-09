# T38b — Guide de mise en ligne pas à pas, pour Théophane

**Objectif** (Q37) : que Théophane mette l'appli en ligne seul, sans jargon, en une heure, et crée son compte. La boucle n'a jamais accès aux secrets : le guide dit quoi copier et où le coller.

**Dépend de** : T38a
**Périmètre** : `docs/mise-en-ligne.md` (nouveau), lien depuis `CLAUDE.md` (tableau des repères) et `docs/brief.md` si utile

## Règles

- Étapes numérotées, une action par ligne, avec ce qu'on doit voir à l'écran :
  1. **Neon** : créer un compte, un projet en région Europe (Francfort), copier l'adresse « pooled » de la base.
  2. **Migrations** : lancer la commande de T38a avec cette adresse (depuis la console de Vercel ou une session Claude Code sans secrets de production : préciser la voie sûre).
  3. **PowerSync Cloud** : compte, instance en région UE, connexion à la base Neon (utilisateur en lecture pour la réplication), règles de synchro `powersync/sync-config.yaml` à coller, clé JWT publique de l'API.
  4. **Brevo** : compte, domaine ou adresse d'envoi vérifiés, clé SMTP.
  5. **Vercel** : nouveau projet « appli » depuis le dépôt GitHub, variables d'environnement une par une (nom exact, d'où vient la valeur), déploiement.
  6. **Premier compte** : ouvrir l'appli, saisir son adresse, recevoir le code à 6 chiffres, créer sa ferme.
- Une section « Ce qui reste gratuit et ses limites » (offres gratuites Neon, PowerSync, Brevo, Vercel, chiffrées) et « Que faire si… » (code non reçu, synchro qui ne part pas, fonction en erreur).
- Rappels de sécurité : jamais de mot de passe ni de clé dans une conversation, un ticket ou le dépôt ; le dépôt est public jusqu'au 1er novembre.

## Critères d'acceptation

- [ ] Chaque variable d'environnement lue par l'API et l'appli (relevée dans le code) figure dans le guide, avec son origine ; un test vérifie que la liste du guide et celle du code coïncident.
- [ ] Relu par un agent qui suit le guide à la lettre sur des comptes fictifs (sans rien créer) et note chaque étape ambiguë.
