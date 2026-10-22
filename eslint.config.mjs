import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextVitals,
  { ignores: ['.next/**', '.taskbook-working/**', '.codex-tmp/**', 'node_modules/**', 'next-env.d.ts', 'services/**', 'scripts/**', 'tests/**', 'prototype/**'] },
  // Preserve the prior Hooks checks; React Compiler is not enabled for this app.
  { rules: { 'react-hooks/set-state-in-effect': 'off', 'react-hooks/refs': 'off' }, linterOptions: { reportUnusedDisableDirectives: 'off' } },
];
