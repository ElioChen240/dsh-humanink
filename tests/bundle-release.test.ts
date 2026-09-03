import { describe, expect, it } from 'vitest';
import { runReleaseChecks } from '../scripts/check-release.mjs';

describe('HumanInk release gate', () => {
  it('accepts the self-contained bundle manifest and required release files', async () => {
    await expect(runReleaseChecks()).resolves.toMatchObject({ ok: true, errors: [] });
  });
});
