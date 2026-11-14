// No GWP-ASan sampling in the app. Since Android 14 the system samples a
// few of every app's memory allocations with GWP-ASan, unless the app says
// otherwise, and records where each sampled one was made by walking the
// stack's frame pointers. Hermes runs JavaScript on a stack of its own
// (hoost_make_fcontext); a walk that starts there runs off its end, into a
// guard page, and the app dies on opening (SIGSEGV in
// android_unsafe_frame_pointer_chase, the Maestro run of 13 Nov 2026).
// Only a sampled allocation does it, so it happens now and then: once at
// a cold start in the lock flow. It is a check for the system's crash
// reports, of no use to anyone using the app.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withGwpAsan(config) {
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:gwpAsanMode'] = 'never';
    return c;
  });
};
