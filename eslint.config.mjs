import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Keeps the loading vocabulary in one place.
 *
 * Waiting is most of what this app does, and it used to be reported four different ways —
 * a swept gradient in the agent panel, plain grey text over the viewer, a pulsing dot in the
 * editor toolbar, bare text in a button. src/components/Working.tsx is now the only place
 * that decides what "this is happening" looks like, and this rule is what keeps it that way:
 * reach for `animate-sweep` or `animate-spin` anywhere else and the build tells you to use
 * WorkingText / WorkingLine / WorkingOverlay / WorkingDot instead.
 */
const LOADING_BELONGS_IN_WORKING = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/components/Working.tsx"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/animate-(sweep|spin)/]",
        message:
          "Loading indicators live in src/components/Working.tsx. Use WorkingText, WorkingLine, " +
          "WorkingOverlay or WorkingDot so every wait in the app looks the same.",
      },
      {
        selector: "TemplateElement[value.raw=/animate-(sweep|spin)/]",
        message:
          "Loading indicators live in src/components/Working.tsx. Use WorkingText, WorkingLine, " +
          "WorkingOverlay or WorkingDot so every wait in the app looks the same.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  LOADING_BELONGS_IN_WORKING,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored OpenSCAD WebAssembly glue — minified, not ours to lint.
    "public/scad/**",
  ]),
]);

export default eslintConfig;
