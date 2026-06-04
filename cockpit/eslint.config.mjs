import next from "eslint-config-next";

// eslint-config-next 16 is a flat-config array (core-web-vitals + typescript).
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...next,
];

export default eslintConfig;
