// Preview and release builds carry no console output except errors, which
// go through the scrubbing logger (src/log.ts) like everything else.
// Dev builds, and Jest, keep the lot.
const variantNow = () => process.env.APP_VARIANT || 'dev';

module.exports = function (api) {
  // Babel re-runs this to decide whether its cached config still holds, so
  // it has to read the environment each time, not remember the first answer.
  const variant = api.cache.using(variantNow);
  const quiet = variant === 'preview' || variant === 'release';
  return {
    presets: ['babel-preset-expo'],
    plugins: quiet ? [['transform-remove-console', { exclude: ['error'] }]] : [],
  };
};
