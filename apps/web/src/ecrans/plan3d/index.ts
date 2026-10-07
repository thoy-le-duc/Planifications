/**
 * Vue 3D (T27) : le seul morceau qui importe three et @react-three/fiber. À charger par import
 * dynamique seulement (./entree.ts, depuis l'écran Planches) : hors du JavaScript de démarrage.
 */
export { Vue3d, Vue3d as default, type ProprietesVue3d } from './Vue3d.tsx';
