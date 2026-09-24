const expoConfig = require('eslint-config-expo/flat');
const a11y = require('eslint-plugin-react-native-a11y');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    plugins: { 'react-native-a11y': a11y },
    rules: {
      ...a11y.configs.all.rules,
      // A hint on every labelled element is noise; add one where the
      // label does not say what happens.
      'react-native-a11y/has-accessibility-hint': 'off',
    },
  },
  {
    ignores: ['dist/*', 'dist-*/*', 'android/*', 'ios/*', '.expo/*', 'expo-env.d.ts'],
  },
]);
