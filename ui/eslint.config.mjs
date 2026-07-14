// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "storybook-static/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react",
          importNames: ["memo", "useMemo", "useCallback"],
          message: "React Compiler owns memoization in this app.",
        }],
      }],
    },
  },
  ...storybook.configs["flat/recommended"]
]);

export default eslintConfig;
