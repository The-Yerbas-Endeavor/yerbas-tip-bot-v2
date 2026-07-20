import test from 'node:test';
import assert from 'node:assert/strict';
import { fromUnits, toUnits } from '../src/services/ledger.js';

test('amount conversion preserves eight decimal places', () => {
  assert.equal(toUnits('1.23456789'), 123456789n);
  assert.equal(fromUnits(123456789n), '1.23456789');
  assert.equal(fromUnits(-1000000n), '-0.01');
});

test('amount parser rejects unsafe values', () => {
  assert.throws(() => toUnits('1.000000001'), /Invalid/);
  assert.throws(() => toUnits('-1'), /Invalid/);
  assert.throws(() => toUnits('1e8'), /Invalid/);
  assert.throws(() => toUnits('not-a-number'), /Invalid/);
});

test('amount formatting removes only insignificant zeroes', () => {
  assert.equal(fromUnits(toUnits('1.23000000')), '1.23');
  assert.equal(fromUnits(toUnits('0.00000001')), '0.00000001');
  assert.equal(fromUnits(toUnits('100')), '100');
});
