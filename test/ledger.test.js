import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, fromUnits, toUnits } from '../src/services/ledger.js';

test('amount conversion preserves eight decimal places', () => {
  assert.equal(toUnits('1.23456789'), 123456789n);
  assert.equal(fromUnits(123456789n), '1.23456789');
  assert.equal(fromUnits(-1000000n), '-0.01');
  assert.throws(() => toUnits('1.000000001'), /Invalid/);
});

test('ledger transfers atomically and rejects overspending', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yerbas-ledger-'));
  const ledger = new Ledger(path.join(dir, 'test.sqlite'));
  try {
    ledger.addEntry('alice', toUnits('10'), 'test_credit', 'credit-1');
    ledger.transfer('alice', 'bob', toUnits('2.5'), 'tip-1');
    assert.equal(ledger.balanceUnits('alice'), toUnits('7.5'));
    assert.equal(ledger.balanceUnits('bob'), toUnits('2.5'));
    assert.throws(() => ledger.transfer('bob', 'alice', toUnits('3'), 'tip-2'), /Insufficient/);
    assert.equal(ledger.balanceUnits('bob'), toUnits('2.5'));
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deposit credit is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yerbas-ledger-'));
  const ledger = new Ledger(path.join(dir, 'test.sqlite'));
  try {
    ledger.creditDeposit('alice', toUnits('5'), 'txid', 0);
    ledger.creditDeposit('alice', toUnits('5'), 'txid', 0);
    assert.equal(ledger.balanceUnits('alice'), toUnits('5'));
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
