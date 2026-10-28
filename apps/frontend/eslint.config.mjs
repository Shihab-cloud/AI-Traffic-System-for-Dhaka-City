import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      // New compiler-powered react-hooks v6 rules (via eslint-config-next 16.2.10).
      // Existing patterns (SSR mount guards, ref-based table internals) trip them;
      // kept as warnings until those patterns are migrated.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    // Icons come from `src/lib/icons.tsx` alone, by meaning — one glyph per meaning, app-wide.
    // `@mui/icons-material` stays installed only because material-react-table imports it. The
    // landing demos are standalone pages, each kept or deleted whole, and use lucide directly.
    ignores: ['src/lib/icons.tsx', 'src/landing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react-icons',
                'react-icons/*',
                'lucide-react',
                '@mui/icons-material',
                '@mui/icons-material/*',
              ],
              message: "Import icons from '@/lib/icons' (add a meaning there if one is missing).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
