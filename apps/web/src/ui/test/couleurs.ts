/** Mesures de couleur pour les tests (T27b) : luminance WCAG, contraste, écart ΔE CIE76. */

function canaux(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`couleur « ${hex} » : attendu #RRGGBB`);
  return [Number.parseInt(m[1] ?? '0', 16) / 255, Number.parseInt(m[2] ?? '0', 16) / 255, Number.parseInt(m[3] ?? '0', 16) / 255];
}

const lineaire = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminance(hex: string): number {
  const [r, g, b] = canaux(hex).map(lineaire) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG 2, de 1 à 21. */
export function contraste(a: string, b: string): number {
  const [claire, foncee] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (claire + 0.05) / (foncee + 0.05);
}

/** CIE L*a*b* (illuminant D65) d'une couleur sRGB. */
export function versLab(hex: string): [number, number, number] {
  const [r, g, b] = canaux(hex).map(lineaire) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)] as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Écart de couleur ΔE CIE76 : distance euclidienne dans L*a*b*. */
export function deltaE76(a: string, b: string): number {
  const [l1, a1, b1] = versLab(a);
  const [l2, a2, b2] = versLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
