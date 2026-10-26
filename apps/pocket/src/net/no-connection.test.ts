import { ApiRequestError, NetworkError } from '@fdv/client';
import { noConnection } from './no-connection';

const named = (name: string, message = 'No.') => Object.assign(new Error(message), { name });

describe('what counts as no connection', () => {
  it('no answer, a timeout, a fetch that found no network, and what the phone would not send', () => {
    for (const err of [
      new NetworkError('offline'),
      new NetworkError('timeout'),
      new TypeError('Network request failed'), // React Native
      new TypeError('Failed to fetch'), // Chrome
      new TypeError('NetworkError when attempting to fetch resource.'), // Firefox
      new TypeError('Load failed'), // Safari
      new TypeError('fetch failed'), // Node
      new TypeError('Unable to resolve host "vault.example"'), // OkHttp
      new TypeError('The Internet connection appears to be offline.'), // iOS
      named('AbortError', 'Aborted'),
      named('TimeoutError', 'Signal timed out.'),
      named('StrangerError'),
      named('WifiOnlyError'),
    ]) {
      expect([err.message, noConnection(err)]).toEqual([err.message, true]);
    }
  });

  it('a programming error, or anything else, is not', () => {
    for (const err of [
      new ReferenceError("Property 'crypto' doesn't exist"),
      new ReferenceError('crypto is not defined'),
      new TypeError("Cannot read property 'getRandomValues' of undefined"),
      new TypeError('undefined is not a function'),
      new SyntaxError('JSON Parse error: Unexpected character'),
      new RangeError('Maximum call stack size exceeded'),
      new Error('file is not a database'),
      new ApiRequestError(503, 'unavailable', 'Busy.'),
      'a string',
      undefined,
    ]) {
      expect([String(err), noConnection(err)]).toEqual([String(err), false]);
    }
  });
});
