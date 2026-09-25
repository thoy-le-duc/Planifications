import { describe, expect, it } from 'vitest';
import { VERSION_MODELE_DONNEES } from './index.ts';

describe('@planif/core', () => {
  it('expose la version du modèle de données', () => {
    expect(VERSION_MODELE_DONNEES).toBe(1);
  });
});
