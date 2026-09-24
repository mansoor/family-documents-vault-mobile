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

module.exports = config;
