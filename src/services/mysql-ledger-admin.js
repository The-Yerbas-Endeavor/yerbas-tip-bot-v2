import { MySqlLedger } from './mysql-ledger.js';
import { fromUnits } from './ledger.js';

MySqlLedger.prototype.adminCredit = async function adminCredit(userId, username, amountUnits, reference, adminId) {
  const amount = fromUnits(BigInt(amountUnits));
  const connection = await this.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [event] = await connection.execute(
      'INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
      ['admin_credit', reference]
    );
    if (event.affectedRows !== 1) {
      await connection.rollback();
      return { changes: 0n };
    }
    await connection.execute(`INSERT INTO user (username, discord_id, balance) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE username=VALUES(username), balance=balance+VALUES(balance)`,
      [String(username).slice(0, 60), userId, amount]
    );
    await connection.execute('INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
      [userId, `Administrative credit ${reference} by ${adminId}`, amount]);
    await connection.commit();
    return { changes: 1n };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

MySqlLedger.prototype.assetHistory = async function assetHistory(userId, limit = 10) {
  const [rows] = await this.pool.execute(
    `SELECT datetime AS created_at, asset_name, amount, type AS entry_type, reference
     FROM v2_asset_payments
     WHERE from_discord_id=? OR to_discord_id=?
     ORDER BY id DESC LIMIT ?`,
    [userId, userId, Number(limit)]
  );
  return rows.map((row) => ({
    ...row,
    signed_amount: row.to_discord_id === userId ? row.amount : `-${row.amount}`
  }));
};
