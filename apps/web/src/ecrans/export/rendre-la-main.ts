/**
 * Rend la main à la boucle d'événements (une vraie tâche : le rendu et les saisies passent).
 * MessageChannel, comme le rendeur du cœur (@planif/core) : un message par tâche, sans le délai
 * des minuteries, que le navigateur étire jusqu'à une seconde ou plus dans un onglet caché (T15e :
 * l'export continue en arrière-plan). Un canal par appel, fermé à la réception : rien ne reste
 * ouvert. Sans MessageChannel : setTimeout.
 */
export function rendreLaMain(): Promise<void> {
  return new Promise<void>((ok) => {
    if (typeof MessageChannel !== 'function') {
      setTimeout(ok, 0);
      return;
    }
    const canal = new MessageChannel();
    canal.port1.onmessage = () => {
      canal.port1.close();
      ok();
    };
    canal.port2.postMessage(0);
  });
}
