// The next code from the run's authenticator app for the e2e owner: the
// workflow's .github/scripts/totp.mjs serve. A runScript runs in Maestro
// itself, on the host, not on the emulator: localhost. Each answer is of a
// time step nobody has had yet: the vault of 0.9.0 takes every code once.
// Maestro's own JavaScript, not the app's.
/* eslint-disable no-var, no-undef */
var response = http.get('http://localhost:8097/code');
output.code = String(response.body).trim();
