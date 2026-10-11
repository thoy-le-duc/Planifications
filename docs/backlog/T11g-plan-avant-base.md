# T11g — Planches : plan affiché avant la base (premier tap dans la première seconde)

**Objectif** : un tap sur « Planches » dans la première seconde après l'ouverture de l'appli affiche le plan en moins de 300 ms, même quand la base locale n'est pas encore prête. Sorti de T11e (décision du chef du 2026-10-10) : la règle ne tient pas en ouvrant seulement la base plus tôt, il faut montrer le plan avant la base.

**Dépend de** : T11e
**Périmètre** : `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/donnees/**`, `apps/web/src/ecrans/plan/**`, `apps/web/e2e/**`, `apps/web/budget.json` (justifié dans la PR)
**Priorité** : basse (Q19 : « ok pour l'instant », sans priorité).

## Précondition du test

L'utilisateur a déjà ouvert Planches une fois sur ce téléphone (comme T13g pour Aujourd'hui : on peut montrer ce qu'il a déjà vu). Le `beforeAll` du test le fait : installation, base prête, ouverture de Planches, retour à Aujourd'hui, puis hors ligne et CPU ×4 (voir `e2e/plan-performances.e2e.ts`). Sans visite préalable, il n'y a pas d'instantané : le test ne porte pas sur ce cas.

## Mesures du testeur (T11e, `docs/mesures/T11e-avant.md`, section 1)

Chromium headless, CPU ×4, ferme de T07, hors ligne, 5 répétitions, tap dès la marque `app-prete` (376 à 547 ms après la navigation), base pas encore prête :

- du tap à la marque `planif:plan-affiche` : 633, 694, 571, 621, 663 ms, soit **médiane 633 ms, pire 694 ms** pour un budget de 300 ms ;
- base prête entre 564 et 884 ms ; entre la base prête et le plan dessiné, encore 290 à 420 ms (lecture du début du plan, journée d'Aujourd'hui relue en même temps) ;
- ouvrir la base plus tôt (`import(appli.ts)`, `indexedDB.databases()`, `import(base-appli.ts)` lancés dès `main.tsx`) ne gagnerait que 100 à 250 ms : insuffisant seul.

## Règle

- **Instantané du début du plan**, gardé sur le téléphone comme celui d'Aujourd'hui (T13d, T13g) : par utilisateur et par ferme, jamais montré à un autre, effacé à la déconnexion, en lecture seule tant que la base n'est pas prête, puis remplacé par le plan relu.
- `App.tsx` monte l'écran Planches dès l'ouverture de la base (comme Aujourd'hui en T13g) au lieu d'attendre `donnees.ferme`.
- Ouverture anticipée de la base depuis `main.tsx` si elle ne coûte rien au démarrage.
- **Budget de démarrage** : 2 octets de marge à la fin de T11b. Compenser ce qui s'ajoute (piste : déplacer la préparation `prechargerPlan`, `prechargerJournee`, `ATTENTE_PLAN_MAX_MS` de `App.tsx` vers `donnees/appli.ts`, chargé à la demande), sinon relever le budget en le justifiant dans la PR.

## Critère d'acceptation

- [ ] Le test ci-dessous (écrit par le testeur de T11e, retiré de `e2e/plan-performances.e2e.ts`, à remettre dans ce fichier tel quel) passe : médiane sous 300 ms et aucune répétition au-delà de 1,5 × 300 ms (`jugerSerie`).
- [ ] Un test vérifie que l'instantané n'est jamais montré à un autre utilisateur ni pour une autre ferme, et qu'il est effacé à la déconnexion.
- [ ] Mesure avant/après chiffrée dans la PR ; `pnpm verif` passe en entier.

```ts
// Constante à remettre : const PREMIERE_SECONDE_MS = 1_000; (la première seconde après la navigation)
// Imports à remettre : jugerSerie, mediane, REPETITIONS_MESURE, decrireSerie, type SerieMesures (./outils.ts).
test('premier tap sur « Planches » dans la première seconde : plan affiché en moins de 300 ms', async () => {
  test.setTimeout(180_000);
  const valeurs: number[] = [];
  for (let i = 0; i < REPETITIONS_MESURE; i += 1) {
    await recharger();
    const baseAuTap = await page.getByTestId('app').getAttribute('data-base');
    await onglet(page, 'Planches').click();
    const r = await tapJusquAuPlanDepuisPremierAppui(page);
    console.log(`premier tap : à ${r.tap.toFixed(0)} ms (base « ${baseAuTap ?? '?'} »), plan à ${r.plan.toFixed(0)} ms → ${r.ms.toFixed(0)} ms`);
    expect(r.tap, 'le tap tombe dans la première seconde').toBeLessThan(PREMIERE_SECONDE_MS);
    await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
    await expect(page.getByTestId('ligne-plan').first()).toBeVisible();
    await expect(page.getByTestId('barre').first()).toBeVisible();
    valeurs.push(r.ms);
    await onglet(page, 'Aujourd’hui').click();
  }
  const serie: SerieMesures = { valeurs, mediane: mediane(valeurs) };
  console.log(decrireSerie('Planches, premier tap dans la première seconde', serie, BUDGET_MS));
  expect(jugerSerie(serie, BUDGET_MS).raisons, 'premier tap sur Planches').toEqual([]);
});
```
