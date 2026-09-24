// Dates in the shared helpers are formatted in the process's time zone;
// pin it so the Node snapshots mean the same thing everywhere.
process.env.TZ = 'UTC';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // pnpm keeps packages under node_modules/.pnpm, so it has to be let
  // through for anything that ships untranspiled code.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@preeternal/.*|lucide-react-native|pdf-lib))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  // @fdv/shared is TypeScript written for Node's module rules: its relative
  // imports say ./x.js for the file x.ts. Drop the extension and let Jest
  // find whichever file is there.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
