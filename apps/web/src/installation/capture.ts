/**
 * T40 — capture de l'invitation à installer l'appli (Android / Chrome), au démarrage.
 *
 * Le navigateur émet `beforeinstallprompt` une seule fois par chargement, parfois avant que les
 * écrans (chargés à la demande) soient là : on le retient tout de suite, sans mini-barre du
 * navigateur (`preventDefault`), dans `window.__planifInvitation`. Le reste (carte, bandeau, aide)
 * est dans ./installation.ts et ses écrans, hors du JavaScript de démarrage. Quelques octets.
 */
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__planifInvitation = e;
});
