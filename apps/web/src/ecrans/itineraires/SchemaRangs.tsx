/**
 * Schéma des rangs (T35a) : vue de dessus d'un tronçon de planche, en SVG pur. Coordonnées en
 * centimètres (viewBox), couleurs par variables CSS (itineraires.css). Géométrie et texte :
 * ./schema-rangs.ts.
 */
import { memo } from 'react';
import { geometrieSchemaRangs, texteCm, texteSchemaRangs, type EntreeSchemaRangs } from './schema-rangs.ts';

function SchemaRangsBrut(e: EntreeSchemaRangs) {
  const g = geometrieSchemaRangs(e);
  const n = g.rangs.length;
  const ecart = e.ecartementCm;
  const bande = g.largeurCm / n;
  const rayon = Math.min(ecart * 0.25, bande * 0.15, g.largeurCm * 0.06);
  // Cote entre les deux premiers plants du rang 1, dans la marge au-dessus du rang.
  const y1 = g.rangs[0] ?? g.largeurCm / 2;
  const marge = Math.max(0, y1 - rayon);
  const police = Math.max(1, Math.min(g.longueurCm * 0.05, marge * 0.6));
  const xa = ecart / 2;
  const xb = xa + ecart;
  const yTrait = y1 - rayon - marge * 0.12;
  const trait = Math.max(0.2, g.longueurCm * 0.003);
  return (
    <svg
      data-testid="schema-rangs"
      className="itin-schema"
      role="img"
      aria-label={texteSchemaRangs(e)}
      viewBox={`0 0 ${String(g.longueurCm)} ${String(g.largeurCm)}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect className="itin-schema-planche" x={0} y={0} width={g.longueurCm} height={g.largeurCm} />
      {g.rangs.map((y, i) => (
        <line key={i} className="itin-schema-rang" x1={0} x2={g.longueurCm} y1={y} y2={y} strokeWidth={trait} />
      ))}
      {g.plants.map((p, i) => (
        <circle key={i} data-testid="plant-schema" data-rang={p.rang} className="itin-schema-plant" cx={p.xCm} cy={p.yCm} r={rayon} />
      ))}
      <g className="itin-schema-cote" strokeWidth={trait}>
        <line x1={xa} x2={xb} y1={yTrait} y2={yTrait} />
        <line x1={xa} x2={xa} y1={yTrait - marge * 0.1} y2={y1 - rayon} />
        <line x1={xb} x2={xb} y1={yTrait - marge * 0.1} y2={y1 - rayon} />
        <text data-testid="cote-ecartement" x={Math.max((xa + xb) / 2, police * 1.6)} y={yTrait - marge * 0.1} fontSize={police} textAnchor="middle">
          {texteCm(ecart)}
        </text>
      </g>
    </svg>
  );
}

/** Redessiné seulement quand une de ses entrées change (pas à chaque frappe ailleurs). */
export const SchemaRangs = memo(SchemaRangsBrut);
