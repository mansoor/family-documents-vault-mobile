import * as shared from '@fdv/shared';
import snapshots from './node-snapshots.json';
import { sharedCases } from './shared-cases';

describe('@fdv/shared inside the app', () => {
  it('the whole @fdv/shared barrel imports under the jest-expo preset', () => {
    expect(typeof shared.canSee).toBe('function');
    expect('negotiate' in shared).toBe(false); // that one is @fdv/client's
    expect(shared.TAP_MIN).toBe(44);
    expect(Object.keys(shared).length).toBeGreaterThan(40);
  });

  it('formatDate, whenWords, parseDateInput and deriveStatus match the Node snapshots', () => {
    expect(sharedCases(shared)).toEqual(snapshots);
  });
});
