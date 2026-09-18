import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/app/version';

describe('application version', () => {
  it('exposes the v0.2 product version', () => {
    expect(APP_VERSION).toBe('0.2.0');
  });
});
