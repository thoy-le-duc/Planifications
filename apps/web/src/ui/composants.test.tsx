// @vitest-environment happy-dom
/**
 * Tests d'acceptation T16 — composants de l'interface (docs/backlog/T16-design.md, maquettes
 * docs/maquettes/*.dc.html). CSS et React seuls, aucune bibliothèque d'interface.
 *
 * Rendu dans un DOM simulé (happy-dom), comme ecrans/export/interaction.test.tsx. Tailles des
 * cibles et couleurs lues dans le style en ligne (comme le test de T15) : les dimensions qui
 * comptent pour les gants sont en px dans `style` ; les couleurs, polices, rayons et ombres
 * y passent par les variables CSS des jetons (`var(--couleur-foret)`, voir ./jetons.test.ts).
 *
 * ── API attendue (apps/web/src/ui/index.ts) ─────────────────────────────────────────────────
 *
 * BoutonPrincipal(props: ButtonHTMLAttributes<HTMLButtonElement>)
 *   <button>, type="button" par défaut (type="submit" accepté), props transmises (onClick,
 *   disabled, aria-*). Style : min-height ≥ 56 px, background var(--couleur-foret), color
 *   var(--couleur-sur-foret), font-family var(--police-titre), box-shadow var(--ombre-basse).
 * BoutonSecondaire(props: ButtonHTMLAttributes<HTMLButtonElement>)
 *   <button>, type="button" par défaut ; min-height ≥ 48 px, color var(--couleur-foret), fond
 *   qui n'est pas la forêt (on le distingue du principal).
 * CarteTache(props: {
 *   titre: string; detail?: string; planche?: string;       // planche : code « T2-P03 »
 *   bande: 'salades' | 'solanacees' | 'cruciferes' | 'racines' | 'retard';
 *   retard?: string;                                         // « 7 jours de retard »
 *   action?: { libelle: string; nomAccessible: string; surAction: () => void };
 * })
 *   racine data-testid="carte-tache", background var(--couleur-surface), border-radius
 *   var(--rayon-carte) ; bande data-testid="bande-famille", background var(--famille-<bande>)
 *   (var(--couleur-orange) pour 'retard'), width ≥ 6 px ; planche en var(--police-code) ;
 *   retard en var(--couleur-texte-orange) ; action : <button type="button"
 *   aria-label={nomAccessible}> qui affiche `libelle`, width ou min-width ≥ 48 px, un tap
 *   appelle surAction. Sans action, aucun bouton.
 * EnTete(props: { titre: string; surtitre?: string; children?: ReactNode })
 *   <header> background var(--couleur-foret), color var(--couleur-sur-foret) ; <h1>{titre}</h1>
 *   en var(--police-titre) ; surtitre en var(--police-code), color var(--couleur-sur-foret-doux) ;
 *   children rendus (pastilles).
 * Pastille(props: { children: ReactNode; ton?: 'urgent' | 'normal' })   // défaut 'normal'
 *   urgent : background var(--couleur-orange), color var(--couleur-sur-orange) ;
 *   normal : background var(--couleur-foret-clair), color var(--couleur-sur-foret).
 * type Onglet = 'aujourdhui' | 'planches' | 'dicter' | 'ferme'
 * ONGLETS: readonly { id: Onglet; libelle: string }[]
 *   dans l'ordre : Aujourd'hui, Planches, Dicter, Ferme.
 * BarreNavigation(props: { actif: Onglet; surChoix: (onglet: Onglet) => void })
 *   <nav aria-label="Navigation principale"> ; quatre <button type="button"> dans l'ordre de
 *   ONGLETS, texte = libellé (icône SVG aria-hidden="true" permise) ; min-height et min-width
 *   ≥ 48 px ; aria-current="page" sur l'onglet actif seulement ; actif en var(--couleur-foret),
 *   inactifs en var(--couleur-tertiaire) ; un tap appelle surChoix(id).
 * AlerteOrange(props: { children: ReactNode; titre?: string })
 *   role="alert", var(--couleur-orange) dans son style (bande ou bord), contenu rendu.
 * Confirmation(props: {
 *   titre: string; message: string; libelleConfirmer: string; libelleAnnuler?: string;  // défaut « Annuler »
 *   surConfirmer: () => void; surAnnuler: () => void; testId?: string;
 * })
 *   role="alertdialog", aria-label={titre}, data-testid={testId} ; le message ; un tap sur le
 *   bouton de confirmation (BoutonPrincipal, ≥ 56 px) suffit ; bouton d'annulation ≥ 48 px.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Onglet = 'aujourdhui' | 'planches' | 'dicter' | 'ferme';
type Bande = 'salades' | 'solanacees' | 'cruciferes' | 'racines' | 'retard';

interface ModuleUi {
  BoutonPrincipal(props: ButtonHTMLAttributes<HTMLButtonElement>): ReactElement;
  BoutonSecondaire(props: ButtonHTMLAttributes<HTMLButtonElement>): ReactElement;
  CarteTache(props: {
    titre: string;
    detail?: string;
    planche?: string;
    bande: Bande;
    retard?: string;
    action?: { libelle: string; nomAccessible: string; surAction: () => void };
  }): ReactElement;
  EnTete(props: { titre: string; surtitre?: string; children?: ReactNode }): ReactElement;
  Pastille(props: { children: ReactNode; ton?: 'urgent' | 'normal' }): ReactElement;
  readonly ONGLETS: readonly { readonly id: Onglet; readonly libelle: string }[];
  BarreNavigation(props: { actif: Onglet; surChoix: (onglet: Onglet) => void }): ReactElement;
  AlerteOrange(props: { children: ReactNode; titre?: string }): ReactElement;
  Confirmation(props: {
    titre: string;
    message: string;
    libelleConfirmer: string;
    libelleAnnuler?: string;
    surConfirmer: () => void;
    surAnnuler: () => void;
    testId?: string;
  }): ReactElement;
}

/** Chemin tenu dans une variable : le typage ne dépend pas du module (écrit par le développeur). */
const CHEMIN_MODULE = './index.ts';

let ui: ModuleUi;

beforeAll(async () => {
  ui = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleUi;
});

/** Rendu serveur, relu dans le DOM simulé pour interroger les éléments et leur style en ligne. */
function statique(element: ReactElement): HTMLElement {
  const boite = document.createElement('div');
  boite.innerHTML = renderToString(element);
  return boite;
}

function style(el: Element | null | undefined): string {
  return (el?.getAttribute('style') ?? '').replace(/\s+/g, ' ');
}

/** Valeur en px d'une propriété du style en ligne (la plus grande si plusieurs propriétés). */
function px(el: Element | null | undefined, ...proprietes: string[]): number {
  const s = style(el);
  let max = Number.NaN;
  for (const p of proprietes) {
    const m = new RegExp(`(?:^|;)\\s*${p}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(s);
    if (m?.[1] !== undefined) max = Number.isNaN(max) ? Number(m[1]) : Math.max(max, Number(m[1]));
  }
  return max;
}

/** Valeur brute d'une propriété du style en ligne. */
function prop(el: Element | null | undefined, propriete: string): string {
  return new RegExp(`(?:^|;)\\s*${propriete}\\s*:\\s*([^;]+)`).exec(style(el))?.[1]?.trim() ?? '';
}

function exiger<T>(v: T | null | undefined, quoi: string): T {
  if (v === null || v === undefined) throw new Error(`${quoi} introuvable`);
  return v;
}

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
});

function rendre(element: ReactElement): void {
  act(() => {
    racine.render(element);
  });
}

function taper(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

describe('BoutonPrincipal', () => {
  it('bouton de 56 px au moins, forêt, titre en Archivo, ombre basse', () => {
    const b = exiger(statique(<ui.BoutonPrincipal>Se connecter</ui.BoutonPrincipal>).querySelector('button'), 'button');
    expect(b.textContent).toBe('Se connecter');
    expect(b.getAttribute('type')).toBe('button');
    expect(px(b, 'min-height', 'height')).toBeGreaterThanOrEqual(56);
    expect(prop(b, 'background(?:-color)?')).toContain('var(--couleur-foret)');
    expect(prop(b, 'color')).toContain('var(--couleur-sur-foret)');
    expect(prop(b, 'font-family')).toContain('var(--police-titre)');
    expect(prop(b, 'box-shadow')).toContain('var(--ombre-basse)');
  });

  it('transmet type, disabled et onClick', () => {
    const b = exiger(statique(<ui.BoutonPrincipal type="submit" disabled>Valider</ui.BoutonPrincipal>).querySelector('button'), 'button');
    expect(b.getAttribute('type')).toBe('submit');
    expect(b.hasAttribute('disabled')).toBe(true);

    const clic = vi.fn();
    rendre(<ui.BoutonPrincipal onClick={clic}>Valider</ui.BoutonPrincipal>);
    taper(exiger(conteneur.querySelector('button'), 'button'));
    expect(clic).toHaveBeenCalledTimes(1);
  });
});

describe('BoutonSecondaire', () => {
  it('48 px au moins, texte forêt, fond distinct du principal', () => {
    const b = exiger(statique(<ui.BoutonSecondaire>Annuler</ui.BoutonSecondaire>).querySelector('button'), 'button');
    expect(b.getAttribute('type')).toBe('button');
    expect(px(b, 'min-height', 'height')).toBeGreaterThanOrEqual(48);
    expect(prop(b, 'color')).toContain('var(--couleur-foret)');
    expect(prop(b, 'background(?:-color)?')).not.toContain('var(--couleur-foret)');
  });
});

describe('CarteTache', () => {
  it('bande de famille, titre, détail, code de planche en mono, gros bouton d’action à droite', () => {
    const surAction = vi.fn();
    const html = statique(
      <ui.CarteTache
        titre="Planter la batavia"
        detail="Grenobloise · 15 m · aujourd'hui"
        planche="T2-P01"
        bande="salades"
        action={{ libelle: 'Fait', nomAccessible: 'Marquer fait : planter la batavia', surAction }}
      />,
    );
    const carte = exiger(html.querySelector('[data-testid="carte-tache"]'), 'carte-tache');
    expect(prop(carte, 'background(?:-color)?')).toContain('var(--couleur-surface)');
    expect(prop(carte, 'border-radius')).toContain('var(--rayon-carte)');
    const bande = exiger(carte.querySelector('[data-testid="bande-famille"]'), 'bande-famille');
    expect(prop(bande, 'background(?:-color)?')).toContain('var(--famille-salades)');
    expect(px(bande, 'width', 'min-width')).toBeGreaterThanOrEqual(6);
    expect(carte.textContent).toContain('Planter la batavia');
    expect(carte.textContent).toContain('Grenobloise · 15 m');
    const planche = exiger(
      [...carte.querySelectorAll('*')].find((e) => e.textContent === 'T2-P01'),
      'code de planche',
    );
    expect(prop(planche, 'font-family')).toContain('var(--police-code)');

    const boutons = carte.querySelectorAll('button');
    expect(boutons).toHaveLength(1);
    const b = exiger(boutons[0], 'bouton d’action');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('Marquer fait : planter la batavia');
    expect(b.textContent).toContain('Fait');
    expect(px(b, 'width', 'min-width')).toBeGreaterThanOrEqual(48);
    // À droite : après le contenu de la carte.
    expect(carte.lastElementChild?.contains(b) ?? false).toBe(true);
  });

  it('un tap sur l’action appelle surAction', () => {
    const surAction = vi.fn();
    rendre(<ui.CarteTache titre="Récolter les radis" bande="cruciferes" action={{ libelle: 'Peser', nomAccessible: 'Saisir une récolte de radis', surAction }} />);
    taper(exiger(conteneur.querySelector('button'), 'bouton'));
    expect(surAction).toHaveBeenCalledTimes(1);
  });

  it('en retard : bande orange, retard en texte orange ; sans action, aucun bouton', () => {
    const html = statique(<ui.CarteTache titre="Planter le chou pointu" bande="retard" retard="7 jours de retard" planche="T2-P03" />);
    const bande = exiger(html.querySelector('[data-testid="bande-famille"]'), 'bande-famille');
    expect(prop(bande, 'background(?:-color)?')).toContain('var(--couleur-orange)');
    const retard = exiger(
      [...html.querySelectorAll('*')].find((e) => e.textContent === '7 jours de retard'),
      'texte du retard',
    );
    expect(prop(retard, 'color')).toContain('var(--couleur-texte-orange)');
    expect(html.querySelectorAll('button')).toHaveLength(0);
  });

  it.each(['solanacees', 'cruciferes', 'racines'] as const)('bande %s', (bande) => {
    const html = statique(<ui.CarteTache titre="Tâche" bande={bande} />);
    expect(prop(html.querySelector('[data-testid="bande-famille"]'), 'background(?:-color)?')).toContain(`var(--famille-${bande})`);
  });
});

describe('EnTete', () => {
  it('en-tête vert, titre h1 en Archivo, surtitre en mono, pastilles', () => {
    const html = statique(
      <ui.EnTete titre="Aujourd'hui" surtitre="LUN. 19 AVRIL · SEMAINE 16">
        <ui.Pastille ton="urgent">1 en retard</ui.Pastille>
      </ui.EnTete>,
    );
    const entete = exiger(html.querySelector('header'), 'header');
    expect(prop(entete, 'background(?:-color)?')).toContain('var(--couleur-foret)');
    expect(prop(entete, 'color')).toContain('var(--couleur-sur-foret)');
    const h1 = exiger(entete.querySelector('h1'), 'h1');
    expect(h1.textContent).toBe("Aujourd'hui");
    expect(prop(h1, 'font-family')).toContain('var(--police-titre)');
    const surtitre = exiger(
      [...entete.querySelectorAll('*')].find((e) => e.textContent === 'LUN. 19 AVRIL · SEMAINE 16'),
      'surtitre',
    );
    expect(prop(surtitre, 'font-family')).toContain('var(--police-code)');
    expect(prop(surtitre, 'color')).toContain('var(--couleur-sur-foret-doux)');
    expect(entete.textContent).toContain('1 en retard');
  });
});

describe('Pastille', () => {
  it('urgente : orange, texte sombre ; normale : forêt claire, texte clair', () => {
    const urgente = exiger(statique(<ui.Pastille ton="urgent">1 en retard</ui.Pastille>).firstElementChild, 'pastille');
    expect(urgente.textContent).toBe('1 en retard');
    expect(prop(urgente, 'background(?:-color)?')).toContain('var(--couleur-orange)');
    expect(prop(urgente, 'color')).toContain('var(--couleur-sur-orange)');
    const normale = exiger(statique(<ui.Pastille>3 cette semaine</ui.Pastille>).firstElementChild, 'pastille');
    expect(prop(normale, 'background(?:-color)?')).toContain('var(--couleur-foret-clair)');
    expect(prop(normale, 'color')).toContain('var(--couleur-sur-foret)');
  });
});

describe('BarreNavigation', () => {
  it('ONGLETS : Aujourd’hui, Planches, Dicter, Ferme', () => {
    expect(ui.ONGLETS.map((o) => o.id)).toEqual(['aujourdhui', 'planches', 'dicter', 'ferme']);
    expect(ui.ONGLETS.map((o) => o.libelle)).toEqual([expect.stringMatching(/^Aujourd['’]hui$/), 'Planches', 'Dicter', 'Ferme']);
  });

  it('quatre cibles de 48 px au moins, onglet actif marqué aria-current="page"', () => {
    const html = statique(<ui.BarreNavigation actif="planches" surChoix={() => undefined} />);
    const nav = exiger(html.querySelector('nav'), 'nav');
    expect(nav.getAttribute('aria-label')).toBe('Navigation principale');
    const boutons = [...nav.querySelectorAll('button')];
    expect(boutons.map((b) => b.textContent.trim())).toEqual([expect.stringMatching(/^Aujourd['’]hui$/), 'Planches', 'Dicter', 'Ferme']);
    for (const b of boutons) {
      expect(b.getAttribute('type')).toBe('button');
      expect(px(b, 'min-height', 'height'), `${b.textContent} : hauteur`).toBeGreaterThanOrEqual(48);
      expect(px(b, 'min-width', 'width'), `${b.textContent} : largeur`).toBeGreaterThanOrEqual(48);
      for (const svg of b.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    expect(boutons.map((b) => b.getAttribute('aria-current'))).toEqual([null, 'page', null, null]);
    expect(prop(boutons[1], 'color')).toContain('var(--couleur-foret)');
    for (const i of [0, 2, 3]) expect(prop(boutons[i], 'color')).toContain('var(--couleur-tertiaire)');
  });

  it('un tap appelle surChoix avec l’onglet', () => {
    const surChoix = vi.fn();
    rendre(<ui.BarreNavigation actif="aujourdhui" surChoix={surChoix} />);
    const ferme = exiger([...conteneur.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Ferme'), 'Ferme');
    taper(ferme);
    expect(surChoix).toHaveBeenCalledWith('ferme');
  });
});

describe('AlerteOrange', () => {
  it('role="alert", marquée orange, contenu rendu', () => {
    const html = statique(<ui.AlerteOrange titre="En retard">Planter le chou pointu</ui.AlerteOrange>);
    const alerte = exiger(html.querySelector('[role="alert"]'), 'alerte');
    expect(alerte.textContent).toContain('Planter le chou pointu');
    expect(alerte.textContent).toContain('En retard');
    const styles = [alerte, ...alerte.querySelectorAll('*')].map((e) => style(e)).join(' ');
    expect(styles).toContain('var(--couleur-orange)');
  });
});

describe('Confirmation en un tap', () => {
  it('alertdialog nommé, message, bouton de confirmation principal (56 px), Annuler (48 px)', () => {
    const html = statique(
      <ui.Confirmation
        titre="Se déconnecter ?"
        message="Des saisies pas encore envoyées pourraient être perdues."
        libelleConfirmer="Se déconnecter quand même"
        surConfirmer={() => undefined}
        surAnnuler={() => undefined}
        testId="confirmation-deconnexion"
      />,
    );
    const dialogue = exiger(html.querySelector('[role="alertdialog"]'), 'alertdialog');
    expect(dialogue.getAttribute('aria-label')).toBe('Se déconnecter ?');
    expect(dialogue.getAttribute('data-testid')).toBe('confirmation-deconnexion');
    expect(dialogue.textContent).toContain('Des saisies pas encore envoyées pourraient être perdues.');
    const boutons = [...dialogue.querySelectorAll('button')];
    const confirmer = exiger(boutons.find((b) => b.textContent.trim() === 'Se déconnecter quand même'), 'confirmer');
    const annuler = exiger(boutons.find((b) => b.textContent.trim() === 'Annuler'), 'annuler');
    expect(px(confirmer, 'min-height', 'height')).toBeGreaterThanOrEqual(56);
    expect(prop(confirmer, 'background(?:-color)?')).toContain('var(--couleur-foret)');
    expect(px(annuler, 'min-height', 'height')).toBeGreaterThanOrEqual(48);
  });

  it('un tap confirme ; un tap annule', () => {
    const surConfirmer = vi.fn();
    const surAnnuler = vi.fn();
    rendre(
      <ui.Confirmation
        titre="Valider ?"
        message="Trois actions comprises."
        libelleConfirmer="Tout valider"
        libelleAnnuler="Corriger"
        surConfirmer={surConfirmer}
        surAnnuler={surAnnuler}
      />,
    );
    const boutons = [...conteneur.querySelectorAll('button')];
    taper(exiger(boutons.find((b) => b.textContent.trim() === 'Tout valider'), 'Tout valider'));
    expect(surConfirmer).toHaveBeenCalledTimes(1);
    expect(surAnnuler).not.toHaveBeenCalled();
    taper(exiger(boutons.find((b) => b.textContent.trim() === 'Corriger'), 'Corriger'));
    expect(surAnnuler).toHaveBeenCalledTimes(1);
  });
});

describe('pas de nouvelle bibliothèque d’interface', () => {
  it('les dépendances de @planif/web restent celles d’avant T16', () => {
    const paquet = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(paquet.dependencies ?? {}).sort()).toEqual(['@planif/core', '@planif/sync', '@powersync/web', 'react', 'react-dom']);
  });
});
