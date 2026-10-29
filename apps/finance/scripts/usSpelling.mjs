// Finance prints US English: "organization", never "organisation". The wording
// Finance imports from @alethical/shared stays as alethical.com writes it; this
// rewrites only the copy compiled into Finance's own build and tests.
const WORDS = [
  [/\borganisation/g, 'organization'],
  [/\bOrganisation/g, 'Organization'],
];

export function toUsSpelling(text) {
  return WORDS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

/** A Vite plugin applying toUsSpelling to every source file it compiles. */
export function usSpelling() {
  return {
    name: 'finance-us-spelling',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('node_modules') || !/\.(ts|tsx)$/.test(id.split('?')[0])) return null;
      const next = toUsSpelling(code);
      return next === code ? null : { code: next, map: null };
    },
  };
}
