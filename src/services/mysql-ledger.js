import mysql from 'mysql2/promise';
import { fromUnits } from './ledger.js';

function amountString(units) {
  return fromUnits(BigInt(units));
}

function normalizeAssetName(assetName) {
  const value = String(assetName).trim();
  if (!value || value.length > 64) throw new Error('Invalid asset name');
  return value;
}

export class MySqlLedger {
  constructor(config) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: config.connectionLimit,
      queueLimit: 0,
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: 'utf8mb4'
    });
  }

  async migrate() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS v2_withdrawal_queue (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        discord_id VARCHAR(60) NOT NULL,
        address VARCHAR(60) NOT NULL,
        amount DECIMAL(32,8) NOT NULL,
        fee DECIMAL(32,8) NOT NULL DEFAULT 0.00000000,
        status ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
        txid VARCHAR(64) DEFAULT NULL,
        error TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id), KEY idx_v2_withdrawal_status (status), KEY idx_v2_withdrawal_discord (discord_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS v2_asset_balances (
        discord_id VARCHAR(60) NOT NULL, asset_name VARCHAR(64) NOT NULL,
        balance DECIMAL(32,8) NOT NULL DEFAULT 0.00000000,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (discord_id, asset_name), KEY idx_v2_asset_name (asset_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS v2_asset_payments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, asset_name VARCHAR(64) NOT NULL,
        amount DECIMAL(32,8) NOT NULL, from_discord_id VARCHAR(60) NOT NULL,
        to_discord_id VARCHAR(60) NOT NULL, type VARCHAR(32) NOT NULL,
        reference VARCHAR(128) NOT NULL, metadata JSON DEFAULT NULL,
        datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
        UNIQUE KEY uq_v2_asset_payment_reference (asset_name, type, reference, from_discord_id, to_discord_id),
        KEY idx_v2_asset_payment_from (from_discord_id), KEY idx_v2_asset_payment_to (to_discord_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS v2_asset_withdrawal_queue (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, discord_id VARCHAR(60) NOT NULL,
        asset_name VARCHAR(64) NOT NULL, address VARCHAR(60) NOT NULL,
        amount DECIMAL(32,8) NOT NULL,
        status ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
        txid VARCHAR(64) DEFAULT NULL, error TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id), KEY idx_v2_asset_withdrawal_status (status),
        KEY idx_v2_asset_withdrawal_discord (discord_id), KEY idx_v2_asset_withdrawal_name (asset_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS v2_processed_events (
        event_type VARCHAR(32) NOT NULL, event_key VARCHAR(191) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (event_type, event_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ];
    for (const sql of statements) await this.pool.query(sql);
  }

  async healthCheck() {
    const [rows] = await this.pool.query('SELECT DATABASE() AS db, VERSION() AS version');
    return rows[0];
  }

  async ensureUser(userId, username = 'unknown') {
    await this.pool.execute(
      `INSERT INTO user (username, discord_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE username=VALUES(username)`,
      [String(username).slice(0, 60), userId]
    );
  }

  async getUser(userId, username = 'unknown') {
    await this.ensureUser(userId, username);
    const [rows] = await this.pool.execute('SELECT * FROM user WHERE discord_id=? LIMIT 1', [userId]);
    return rows[0];
  }

  async getUserByAddress(address) {
    const [rows] = await this.pool.execute('SELECT * FROM user WHERE deposit_address=? LIMIT 1', [address]);
    return rows[0] ?? null;
  }

  async setDepositAddress(userId, address) {
    await this.pool.execute('UPDATE user SET deposit_address=? WHERE discord_id=?', [address, userId]);
  }

  async balanceUnits(userId, username = 'unknown') {
    const user = await this.getUser(userId, username);
    const [whole, fraction = ''] = String(user.balance).split('.');
    return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
  }

  async transfer(fromUserId, toUserId, amountUnits, reference, names = {}) {
    const amount = amountString(amountUnits);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`INSERT INTO user (username, discord_id) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE username=VALUES(username)`, [String(names.from ?? 'unknown').slice(0, 60), fromUserId]);
      await connection.execute(`INSERT INTO user (username, discord_id) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE username=VALUES(username)`, [String(names.to ?? 'unknown').slice(0, 60), toUserId]);
      const [rows] = await connection.execute('SELECT balance FROM user WHERE discord_id=? FOR UPDATE', [fromUserId]);
      if (!rows[0] || Number(rows[0].balance) < Number(amount)) throw new Error('Insufficient balance');
      await connection.execute('UPDATE user SET balance=balance-? WHERE discord_id=?', [amount, fromUserId]);
      await connection.execute('UPDATE user SET balance=balance+? WHERE discord_id=?', [amount, toUserId]);
      await connection.execute(
        'INSERT INTO payments (amount, from_discord_id, to_discord_id, type) VALUES (?, ?, ?, ?)',
        [amount, fromUserId, toUserId, 'tipUser']
      );
      await connection.execute(
        'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [fromUserId, `Sent tip to user ${toUserId} [${reference}]`, amount]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async creditDeposit(userId, amountUnits, txid, vout = 0) {
    const amount = amountString(amountUnits);
    const key = `${txid}:${vout}`;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [event] = await connection.execute(
        'INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
        ['yerb_deposit', key]
      );
      if (event.affectedRows !== 1) {
        await connection.rollback();
        return { changes: 0n };
      }
      const [users] = await connection.execute('SELECT deposit_address FROM user WHERE discord_id=? FOR UPDATE', [userId]);
      if (!users[0]) throw new Error('Deposit user not found');
      await connection.execute('UPDATE user SET balance=balance+? WHERE discord_id=?', [amount, userId]);
      await connection.execute(
        `INSERT INTO deposits (address, amount, txid, confirmations, credited)
         VALUES (?, ?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE confirmations=GREATEST(confirmations, VALUES(confirmations)), credited=1`,
        [users[0].deposit_address, amount, txid]
      );
      await connection.execute('INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [userId, `Credited balance from ${txid}`, amount]);
      await connection.commit();
      return { changes: 1n };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createWithdrawal(userId, address, amountUnits, feeUnits) {
    const amount = amountString(amountUnits);
    const fee = amountString(feeUnits);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT balance FROM user WHERE discord_id=? FOR UPDATE', [userId]);
      if (!rows[0] || Number(rows[0].balance) < Number(amount) + Number(fee)) throw new Error('Insufficient balance');
      await connection.execute('UPDATE user SET balance=balance-?-? WHERE discord_id=?', [amount, fee, userId]);
      const [result] = await connection.execute(
        'INSERT INTO v2_withdrawal_queue (discord_id, address, amount, fee) VALUES (?, ?, ?, ?)',
        [userId, address, amount, fee]
      );
      await connection.execute('INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [userId, `Queued withdrawal #${result.insertId} to ${address}`, amount]);
      await connection.commit();
      return Number(result.insertId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimPendingWithdrawal() {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT * FROM v2_withdrawal_queue WHERE status='pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows[0]) { await connection.commit(); return null; }
      await connection.execute("UPDATE v2_withdrawal_queue SET status='processing' WHERE id=?", [rows[0].id]);
      await connection.commit();
      return rows[0];
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  async markWithdrawalSent(id, txid) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT * FROM v2_withdrawal_queue WHERE id=? AND status='processing' FOR UPDATE", [id]);
      if (!rows[0]) { await connection.rollback(); return; }
      const row = rows[0];
      await connection.execute("UPDATE v2_withdrawal_queue SET status='sent', txid=? WHERE id=?", [txid, id]);
      await connection.execute('INSERT INTO withdrawals (discord_id, address, amount, txid) VALUES (?, ?, ?, ?)',
        [row.discord_id, row.address, row.amount, txid]);
      await connection.execute('INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [row.discord_id, `Withdrawal #${id} sent: ${txid}`, row.amount]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async markWithdrawalFailed(id, errorMessage) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT * FROM v2_withdrawal_queue WHERE id=? AND status='processing' FOR UPDATE", [id]);
      if (!rows[0]) { await connection.rollback(); return; }
      const row = rows[0];
      await connection.execute("UPDATE v2_withdrawal_queue SET status='failed', error=? WHERE id=?", [String(errorMessage), id]);
      await connection.execute('UPDATE user SET balance=balance+?+? WHERE discord_id=?', [row.amount, row.fee, row.discord_id]);
      await connection.execute('INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [row.discord_id, `Withdrawal #${id} failed and refunded: ${errorMessage}`, row.amount]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async history(userId, limit = 10) {
    const [rows] = await this.pool.execute(
      `SELECT datetime AS created_at, description AS entry_type, value AS amount
       FROM log WHERE discord_id=? ORDER BY id DESC LIMIT ?`, [userId, Number(limit)]
    );
    return rows;
  }

  async assetBalanceUnits(userId, assetName) {
    const name = normalizeAssetName(assetName);
    const [rows] = await this.pool.execute('SELECT balance FROM v2_asset_balances WHERE discord_id=? AND asset_name=?', [userId, name]);
    const value = rows[0]?.balance ?? '0.00000000';
    const [whole, fraction = ''] = String(value).split('.');
    return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
  }

  async assetBalances(userId) {
    const [rows] = await this.pool.execute(
      'SELECT asset_name, balance FROM v2_asset_balances WHERE discord_id=? AND balance<>0 ORDER BY asset_name', [userId]
    );
    return rows;
  }

  async addAssetCredit(userId, assetName, amountUnits, type, reference, metadata = null) {
    const name = normalizeAssetName(assetName);
    const amount = amountString(amountUnits);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [event] = await connection.execute('INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
        [type, `${name}:${reference}:${userId}`]);
      if (event.affectedRows !== 1) { await connection.rollback(); return { changes: 0n }; }
      await connection.execute(`INSERT INTO v2_asset_balances (discord_id, asset_name, balance) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)`, [userId, name, amount]);
      await connection.execute(`INSERT INTO v2_asset_payments
        (asset_name, amount, from_discord_id, to_discord_id, type, reference, metadata)
        VALUES (?, ?, 'SYSTEM', ?, ?, ?, ?)`, [name, amount, userId, type, reference, metadata ? JSON.stringify(metadata) : null]);
      await connection.commit();
      return { changes: 1n };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async transferAsset(fromUserId, toUserId, assetName, amountUnits, reference) {
    const name = normalizeAssetName(assetName);
    const amount = amountString(amountUnits);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`INSERT IGNORE INTO v2_asset_balances (discord_id, asset_name, balance) VALUES (?, ?, 0)`, [fromUserId, name]);
      await connection.execute(`INSERT IGNORE INTO v2_asset_balances (discord_id, asset_name, balance) VALUES (?, ?, 0)`, [toUserId, name]);
      const [rows] = await connection.execute('SELECT balance FROM v2_asset_balances WHERE discord_id=? AND asset_name=? FOR UPDATE', [fromUserId, name]);
      if (!rows[0] || Number(rows[0].balance) < Number(amount)) throw new Error(`Insufficient ${name} balance`);
      await connection.execute('UPDATE v2_asset_balances SET balance=balance-? WHERE discord_id=? AND asset_name=?', [amount, fromUserId, name]);
      await connection.execute('UPDATE v2_asset_balances SET balance=balance+? WHERE discord_id=? AND asset_name=?', [amount, toUserId, name]);
      await connection.execute(`INSERT INTO v2_asset_payments
        (asset_name, amount, from_discord_id, to_discord_id, type, reference)
        VALUES (?, ?, ?, ?, 'asset_tip', ?)`, [name, amount, fromUserId, toUserId, reference]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async createAssetWithdrawal(userId, assetName, address, amountUnits) {
    const name = normalizeAssetName(assetName);
    const amount = amountString(amountUnits);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT balance FROM v2_asset_balances WHERE discord_id=? AND asset_name=? FOR UPDATE', [userId, name]);
      if (!rows[0] || Number(rows[0].balance) < Number(amount)) throw new Error(`Insufficient ${name} balance`);
      await connection.execute('UPDATE v2_asset_balances SET balance=balance-? WHERE discord_id=? AND asset_name=?', [amount, userId, name]);
      const [result] = await connection.execute(`INSERT INTO v2_asset_withdrawal_queue
        (discord_id, asset_name, address, amount) VALUES (?, ?, ?, ?)`, [userId, name, address, amount]);
      await connection.commit();
      return Number(result.insertId);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async claimPendingAssetWithdrawal() {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT * FROM v2_asset_withdrawal_queue WHERE status='pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows[0]) { await connection.commit(); return null; }
      await connection.execute("UPDATE v2_asset_withdrawal_queue SET status='processing' WHERE id=?", [rows[0].id]);
      await connection.commit();
      return rows[0];
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async markAssetWithdrawalSent(id, txid) {
    await this.pool.execute("UPDATE v2_asset_withdrawal_queue SET status='sent', txid=? WHERE id=? AND status='processing'", [txid, id]);
  }

  async markAssetWithdrawalFailed(id, errorMessage) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT * FROM v2_asset_withdrawal_queue WHERE id=? AND status='processing' FOR UPDATE", [id]);
      if (!rows[0]) { await connection.rollback(); return; }
      const row = rows[0];
      await connection.execute("UPDATE v2_asset_withdrawal_queue SET status='failed', error=? WHERE id=?", [String(errorMessage), id]);
      await connection.execute('UPDATE v2_asset_balances SET balance=balance+? WHERE discord_id=? AND asset_name=?', [row.amount, row.discord_id, row.asset_name]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async close() { await this.pool.end(); }
}
