import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeEaVersion, parseStableTags } from './ea-version.mjs';

describe('computeEaVersion', () => {
  it('uses the package version when it has not shipped yet', () => {
    assert.equal(computeEaVersion('0.2.0', ['0.1.0', '0.1.1'], 7), '0.2.0-ea.7');
  });

  it('uses the package version when there are no stable tags', () => {
    assert.equal(computeEaVersion('0.1.0', [], 1), '0.1.0-ea.1');
  });

  it('bumps the patch when the package version is already tagged', () => {
    assert.equal(computeEaVersion('0.1.1', ['0.1.0', '0.1.1'], 3), '0.1.2-ea.3');
  });

  it('bumps past a stable tag newer than package.json', () => {
    // v0.1.2 tagged while package.json still says 0.1.1: EA must sort above 0.1.2.
    assert.equal(computeEaVersion('0.1.1', ['0.1.0', '0.1.1', '0.1.2'], 9), '0.1.3-ea.9');
  });

  it('compares versions numerically, not lexically', () => {
    assert.equal(computeEaVersion('0.1.9', ['0.1.10', '0.1.9', '0.2.0'], 4), '0.2.1-ea.4');
    assert.equal(computeEaVersion('0.9.0', ['0.10.0'], 4), '0.10.1-ea.4');
  });

  it('rejects non-stable package versions and bad run numbers', () => {
    assert.throws(() => computeEaVersion('0.1.1-ea.2', [], 1));
    assert.throws(() => computeEaVersion('0.1.1', [], 'abc'));
  });
});

describe('parseStableTags', () => {
  it('keeps only stable vX.Y.Z tags from git ls-remote output', () => {
    const output = [
      'c7c5\trefs/tags/v0.1.0',
      '4c3a\trefs/tags/v0.1.0^{}',
      '7bae\trefs/tags/v0.1.1',
      '9cc2\trefs/tags/v0.1.1-ea.1',
      '7833\trefs/tags/v0.1.2-ea.2^{}',
      'abcd\trefs/tags/nightly',
      '',
    ];
    assert.deepEqual(parseStableTags(output), ['0.1.0', '0.1.1']);
  });

  it('accepts plain tag names', () => {
    assert.deepEqual(parseStableTags(['v1.2.3', 'v1.2.3-ea.1']), ['1.2.3']);
  });
});
