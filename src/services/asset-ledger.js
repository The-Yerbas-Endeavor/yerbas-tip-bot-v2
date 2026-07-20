import Database from 'better-sqlite3';
import { fromUnits } from './ledger.js';

export class AssetLedger {
  constructor(databasePath) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asset_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        amount_units INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        reference TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(asset_name, entry_type, reference, discord_user_id)
      );
      CREATE TABLE IF NOT EXISTS asset_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        address TEXT NOT NULL,
        amount_units INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        txid TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_asset_ledger_user_asset
        ON asset_ledger_entries(discord_user_id, asset_name);
      CREATE INDEX IF NOT EXISTS idx_asset_withdrawal_status
        ON asset_withdrawals(status);
    `);
  }

  normalizeAssetName(assetName) {
    const value = String(assetName).trim();
    if (!value || value.length > 32) throw new Error('Invalid asset name');
    return value;
  }

  balanceUnits(userId, assetName) {
    const name = this.normalizeAssetName(assetName);
    const row = this.db.prepare(`SELECT COALESCE(SUM(amount_units), 0) AS balance
      FROM asset_ledger_entries WHERE discord_user_id=? AND asset_name=?`).get(userId, name);
    return BigInt(row.balance);
  }

  balances(userId) {
    return this.db.prepare(`SELECT asset_name, SUM(amount_units) AS balance_units
      FROM asset_ledger_entries WHERE discord_user_id=?
      GROUP BY asset_name HAVING SUM(amount_units) != 0 ORDER BY asset_name`).all(userId);
  }

  addEntry(userId, assetName, amountUnits, type, reference, metadata = null) {
    const name = this.normalizeAssetName(assetName);
    return this.db.prepare(`INSERT OR IGNORE INTO asset_ledger_entries
      (discord_user_id, asset_name, amount_units, entry_type, reference, metadata)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      userId,
      name,
      Number(BigInt(amountUnits)),
      type,
      reference,
      metadata ? JSON.stringify(metadata) : null
    );
  }

  transfer(fromUserId, toUserId, assetName, amountUnits, reference) {
    const name = this.normalizeAssetName(assetName);
    const amount = BigInt(amountUnits);
    if (amount <= 0n) throw new Error('Asset transfer amount must be positive');

    this.db.transaction(() => {
      if (this.balanceUnits(fromUserId, name) < amount) {
        throw new Error(`Insufficient ${name} balance`);
      }
      this.addEntry(fromUserId, name, -amount, 'asset_tip_debit', reference, { toUserId });
      this.addEntry(toUserId, name, amount, 'asset_tip_credit', reference, { fromUserId });
    })();
  }

  createWithdrawal(userId, assetName, address, amountUnits) {
    const name = this.normalizeAssetName(assetName);
    const amount = BigInt(amountUnits);
    if (amount <= 0n) throw new Error('Asset withdrawal amount must be positive');

    return this.db.transaction(() => {
      if (this.balanceUnits(userId, name) < amount) throw new Error(`Insufficient ${name} balance`);
      const result = this.db.prepare(`INSERT INTO asset_withdrawals
        (discord_user_id, asset_name, address, amount_units) VALUES (?, ?, ?, ?)`)
        .run(userId, name, address, Number(amount));
      this.addEntry(userId, name, -amount, 'asset_withdrawal_hold', String(result.lastInsertRowid), { address });
      return Number(result.lastInsertRowid);
    })();
  }

  claimPendingWithdrawal() {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM asset_withdrawals WHERE status='pending' ORDER BY id LIMIT 1").get();
      if (!row) return null;
      const result = this.db.prepare("UPDATE asset_withdrawals SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(row.id);
      return result.changes === 1 ? row : null;
    })();
  }

  markWithdrawalSent(id, txid) {
    this.db.prepare("UPDATE asset_withdrawals SET status='sent', txid=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'").run(txid, id);
  }

  markWithdrawalFailed(id, error) {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM asset_withdrawals WHERE id=? AND status='processing'").get(id);
      if (!row) return;
      this.db.prepare("UPDATE asset_withdrawals SET status='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error), id);
      this.addEntry(row.discord_user_id, row.asset_name, BigInt(row.amount_units), 'asset_withdrawal_refund', String(id), { error: String(error) });
    })();
  }

  history(userId, limit = 10) {
    return this.db.prepare(`SELECT asset_name, amount_units, entry_type, reference, created_at
      FROM asset_ledger_entries WHERE discord_user_id=? ORDER BY id DESC LIMIT ?`).all(userId, limit);
  }

  describeBalance(userId, assetName) {
    return `${fromUnits(this.balanceUnits(userId, assetName))} ${this.normalizeAssetName(assetName)}`;
  }

  close() { this.db.close(); }
}
