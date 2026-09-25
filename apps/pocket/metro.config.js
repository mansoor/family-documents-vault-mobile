// Expo's own Metro config: it understands pnpm workspaces and finds the
// @fdv/shared sources under vendor/fdv.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @fdv/shared is TypeScript written for Node's module rules: its relative
// imports say ./x.js for the file x.ts, which Metro does not map by
// itself. For files under vendor/fdv/packages only, try x.ts first.
const vendor = path.resolve(__dirname, '../../vendor/fdv/packages') + path.sep;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // tslib 2's ES entry (modules/index.js) imports its CommonJS build as a
  // default export, which Metro's web bundle hands over as undefined — the
  // app then fails to start ("Cannot destructure property '__extends'").
  // Its plain ES build has no such step. (expo-router's web dialog pulls it in.)
  if (moduleName === 'tslib' && platform === 'web') {
    return context.resolveRequest(context, 'tslib/tslib.es6.js', platform);
  }
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    path.resolve(context.originModulePath).startsWith(vendor)
  ) {
    try {
      return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
    } catch {
      // Not a TypeScript file after all: resolve as written.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

// expo-sqlite's web build loads SQLite as WebAssembly. Only the spike's
// probes screen uses it, but every route is bundled for the web build.
config.resolver.assetExts.push('wasm');

// The Babel config depends on APP_VARIANT (preview and release drop console
// calls), which Metro's transform cache does not know about. Keep one cache
// per variant so a preview build never reuses a dev build's output.
config.cacheVersion = `${config.cacheVersion ?? ''}:${process.env.APP_VARIANT || 'dev'}`;

module.exports = config;
