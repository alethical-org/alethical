// Each line reaches something the walk cannot follow, or that only Expo defines.
export const development = globalThis.__DEV__;
export const environment = window.process;
export const legacyDevelopment = global['__DEV__'];
export const load = (name: string) => import(name);
export const loadNamed = (name: string) => require(`./${name}`);
