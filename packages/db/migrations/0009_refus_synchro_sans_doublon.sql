-- T10 (relecture M2) : un lot renvoyé ne crée pas de refus en double.
ALTER TABLE "refus_synchro" ADD CONSTRAINT "refus_synchro_sans_doublon" UNIQUE("utilisateur_id","ligne_id","operation","motif");
