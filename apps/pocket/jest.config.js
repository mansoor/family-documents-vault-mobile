// Dates in the shared helpers are formatted in the process's time zone;
// pin it so the Node snapshots mean the same thing everywhere.
process.env.TZ = 'UTC';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // On a cold transform cache (every CI run) the first screen test in a
  // file spends most of Jest's default 5 s loading React Native, the icons
  // and the router under parallel load before its own code runs.
  testTimeout: 30_000,
  // pnpm keeps packages under node_modules/.pnpm, so it has to be let
  // through for anything that ships untranspiled code.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@preeternal/.*|lucide-react-native|pdf-lib))',
  ],
  // e2e-web holds the Playwright specs, which run in a browser, not here.
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/e2e-web/'],
  setupFilesAfterEnv: ['<rootDir>/src/test-support/setup.ts'],
  // @fdv/shared is TypeScript written for Node's module rules: its relative
  // imports say ./x.js for the file x.ts. Drop the extension and let Jest
  // find whichever file is there.
  moduleNameMapper: {
    '^vitest$': '<rootDir>/src/test-support/vitest-shim.ts',
    // The react-native condition resolves lucide to its .mjs build, which
    // the preset does not transform; the CommonJS build is the same icons.
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
