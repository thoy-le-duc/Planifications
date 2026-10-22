/**
 * Vue 3D (T58, règle 3) — de l'état des équipements aux bâtiments de la scène : ouvrants relevés,
 * porte ouverte, chauffage et voile (`ouvertures`), et filtre « Serres » qui montre en couleur
 * vive tout ce qui est ouvert. Pur : ni React, ni three, ni horloge (l'instant est un paramètre).
 * Les règles (équipements déclarés, état courant, ce qui ouvre un abri) sont celles du cœur
 * (@planif/core/abris). Chargé à la demande avec ./Abris3d.tsx, à part du morceau 3D. Contrat :
 * ./test/contrat-abris.ts.
 */
import { equipementsDeZone, etatsDesZones, type EvenementEtatAbri, type ZoneAbri } from '@planif/core/abris';
import type { EquipementAbri } from '@planif/core';
import { COULEUR_ESTOMPEE, COULEURS_SERRES_3D } from '../../ui/jetons.ts';
import type { BatimentScene, OuverturesBatiment, Scene, SceneFiltree } from './scene.ts';

/** État d'un abri dans la scène. */
export interface EtatBatiment {
  readonly zoneId: string;
  /** Nom de la zone abritée. */
  readonly nom: string;
  /** Au moins un ouvrant ou une porte ouverts (comme `abrisOuverts` du cœur). */
  readonly ouvert: boolean;
  /** Ouvrants et portes ouverts, ordre canonique. */
  readonly ouverts: readonly EquipementAbri[];
  readonly ouvertures: OuverturesBatiment;
}

const OUVRANTS: readonly EquipementAbri[] = ['ouvrants_lateraux', 'ouvrants_faitage', 'portes'];

/**
 * Un état par bâtiment qui abrite une zone de `zones` déclarant au moins un équipement (ni hangar,
 * ni zone inconnue : autre ferme, supprimée ; ni plein champ).
 */
export function etatsBatiments(
  batiments: readonly Pick<BatimentScene, 'id' | 'zoneId'>[],
  zones: readonly ZoneAbri[],
  evenements: readonly EvenementEtatAbri[],
  instant: string,
): Map<string, EtatBatiment> {
  const parZone = new Map(zones.filter((z) => equipementsDeZone(z).length > 0).map((z) => [z.id, z]));
  const abrites: { readonly id: string; readonly zone: ZoneAbri }[] = [];
  for (const b of batiments) {
    const zone = b.zoneId === null ? undefined : parZone.get(b.zoneId);
    if (zone !== undefined) abrites.push({ id: b.id, zone });
  }
  const etats = etatsDesZones(evenements, [...new Set(abrites.map((b) => b.zone))], instant);
  const resultat = new Map<string, EtatBatiment>();
  for (const { id, zone } of abrites) {
    const actifs = new Set((etats.get(zone.id) ?? []).filter((x) => x.etat?.actif === true).map((x) => x.equipement));
    const ouverts = OUVRANTS.filter((e) => actifs.has(e));
    resultat.set(id, {
      zoneId: zone.id,
      nom: zone.nom,
      ouvert: ouverts.length > 0,
      ouverts,
      ouvertures: {
        lateraux: actifs.has('ouvrants_lateraux'),
        faitage: actifs.has('ouvrants_faitage'),
        portes: actifs.has('portes'),
        chauffage: actifs.has('chauffage'),
        voile: actifs.has('voile'),
      },
    });
  }
  return resultat;
}

/** Les abris de `etats` gagnent leurs `ouvertures` ; le reste de la scène est rendu tel quel. */
export function poserOuvertures(scene: Scene, etats: ReadonlyMap<string, EtatBatiment>): Scene {
  if (etats.size === 0) return scene;
  return {
    ...scene,
    batiments: scene.batiments.map((b) => {
      const e = etats.get(b.id);
      return e === undefined ? b : { ...b, ouvertures: e.ouvertures };
    }),
  };
}

/** Filtre « Serres » : `ouverte` est la couleur vive de ce qui reste ouvert. */
export const COULEURS_SERRES: { readonly ouverte: string; readonly fermee: string } = { ouverte: COULEURS_SERRES_3D.ouverte, fermee: COULEURS_SERRES_3D.fermee };

/**
 * Filtre « Serres » : abris ouverts en couleur vive, abris fermés en couleur calme, tout autre
 * bâtiment estompé ; les planches d'un abri ouvert gardent leur couleur, les autres sont estompées.
 * Filtre éteint : la scène reçue elle-même.
 */
export function colorerSerres(filtree: SceneFiltree, etats: ReadonlyMap<string, EtatBatiment>, filtre: boolean): SceneFiltree {
  if (!filtre) return filtree;
  const zonesOuvertes = new Set([...etats.values()].filter((e) => e.ouvert).map((e) => e.zoneId));
  return {
    ...filtree,
    batiments: filtree.batiments.map((b) => {
      const e = etats.get(b.id);
      const couleur = e === undefined ? COULEUR_ESTOMPEE : e.ouvert ? COULEURS_SERRES.ouverte : COULEURS_SERRES.fermee;
      return { ...b, couleur };
    }),
    volumes: filtree.volumes.map((v) => (zonesOuvertes.has(v.zoneId) ? v : { ...v, estompe: true, couleur: COULEUR_ESTOMPEE })),
  };
}
