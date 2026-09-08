// lint-staged restores unstaged edits and stages only the formatted selection.
export default {
  '{alethical,scripts}/**/*.py': ['uvx ruff@0.15.0 check', 'uvx ruff@0.15.0 format'],
  'apps/frontend/**/*.{js,jsx,ts,tsx,mjs,cjs,json,md,yml,yaml,css,html}':
    'node scripts/format_frontend.mjs',
};
