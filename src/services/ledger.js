import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCALE = 100000000n;

export function toUnits(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) throw new Error('Invalid YERB amount');
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

export function fromUnits(units) {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export class Ledger {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.defaultSafeIntegers(true);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        discord_user_id TEXT PRIMARY KEY,
        deposit_address TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        amount_units INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        reference TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(entry_type, reference, discord_user_id),
        FOREIGN KEY(discord_user_id) REFERENCES users(discord_user_id)
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        address TEXT NOT NULL,
        amount_units INTEGER NOT NULL,
        fee_units INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        txid TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(discord_user_id) REFERENCES users(discord_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(discord_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_address ON users(deposit_address);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawals(status);
    `);
  }

  ensureUser(userId) {
    this.db.prepare('INSERT OR IGNORE INTO users(discord_user_id) VALUES (?)').run(userId);
  }

  getUser(userId) {
    this.ensureUser(userId);
    return this.db.prepare('SELECT * FROM users WHERE discord_user_id = ?').get(userId);
  }

  getUserByAddress(address) {
    return this.db.prepare('SELECT * FROM users WHERE deposit_address = ?').get(address);
  }

  setDepositAddress(userId, address) {
    this.ensureUser(userId);
    this.db.prepare('UPDATE users SET deposit_address = ? WHERE discord_user_id = ?').run(address, userId);
  }

  balanceUnits(userId) {
    this.ensureUser(userId);
    const row = this.db.prepare('SELECT COALESCE(SUM(amount_units), 0) AS balance FROM ledger_entries WHERE discord_user_id = ?').get(userId);
    return BigInt(row.balance);
  }

  addEntry(userId, amountUnits, type, reference, metadata = null) {
    this.ensureUser(userId);
    return this.db.prepare(`INSERT OR IGNORE INTO ledger_entries(discord_user_id, amount_units, entry_type, reference, metadata)
      VALUES (?, ?, ?, ?, ?)`).run(userId, BigInt(amountUnits), type, reference, metadata ? JSON.stringify(metadata) : null);
  }

  transfer(fromUserId, toUserId, amountUnits, reference) {
    const amount = BigInt(amountUnits);
    if (amount <= 0n) throw new Error('Transfer amount must be positive');
    this.db.transaction(() => {
      this.ensureUser(fromUserId);
      this.ensureUser(toUserId);
      if (this.balanceUnits(fromUserId) < amount) throw new Error('Insufficient balance');
      this.addEntry(fromUserId, -amount, 'tip_debit', reference, { toUserId });
      this.addEntry(toUserId, amount, 'tip_credit', reference, { fromUserId });
    })();
  }

  creditDeposit(userId, amountUnits, txid, vout = 0) {
    return this.addEntry(userId, amountUnits, 'deposit', `${txid}:${vout}`, { txid, vout });
  }

  createWithdrawal(userId, address, amountUnits, feeUnits) {
    const amount = BigInt(amountUnits);
    const fee = BigInt(feeUnits);
    return this.db.transaction(() => {
      this.ensureUser(userId);
      if (this.balanceUnits(userId) < amount + fee) throw new Error('Insufficient balance');
      const result = this.db.prepare(`INSERT INTO withdrawals(discord_user_id, address, amount_units, fee_units)
        VALUES (?, ?, ?, ?)`).run(userId, address, amount, fee);
      this.addEntry(userId, -(amount + fee), 'withdrawal_hold', String(result.lastInsertRowid), { address });
      return Number(result.lastInsertRowid);
    })();
  }

  claimPendingWithdrawal() {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM withdrawals WHERE status='pending' ORDER BY id LIMIT 1").get();
      if (!row) return null;
      const changed = this.db.prepare("UPDATE withdrawals SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(row.id);
      return changed.changes === 1n ? row : null;
    })();
  }

  markWithdrawalSent(id, txid) {
    this.db.prepare("UPDATE withdrawals SET status='sent', txid=?, error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'").run(txid, id);
  }

  markWithdrawalFailed(id, error) {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id);
      if (!row || row.status !== 'processing') return;
      this.db.prepare("UPDATE withdrawals SET status='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error).slice(0, 1000), id);
      this.addEntry(row.discord_user_id, row.amount_units + row.fee_units, 'withdrawal_refund', String(id), { reason: String(error) });
    })();
  }

  pendingWithdrawals() {
    return this.db.prepare("SELECT * FROM withdrawals WHERE status IN ('pending','processing') ORDER BY id").all();
  }

  history(userId, limit = 10) {
    return this.db.prepare(`SELECT amount_units, entry_type, reference, created_at FROM ledger_entries
      WHERE discord_user_id=? ORDER BY id DESC LIMIT ?`).all(userId, BigInt(limit));
  }

  close() { this.db.close(); }
}
