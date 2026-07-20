import { toUnits, fromUnits } from './ledger.js';

export class WalletWorker {
  constructor({ config, ledger, rpc, intervalMs = 30000 }) {
    this.config = config;
    this.ledger = ledger;
    this.rpc = rpc;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.config.walletEnabled || this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => console.error('Wallet worker failed:', error)), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcileDeposits();
      if (this.config.withdrawalsEnabled) await this.processOneWithdrawal();
      if (this.config.assetsEnabled && this.config.assetWithdrawalsEnabled) await this.processOneAssetWithdrawal();
    } finally {
      this.running = false;
    }
  }

  async reconcileDeposits() {
    const transactions = await this.rpc.listTransactions('*', 1000, 0);
    for (const tx of transactions) {
      if (tx.category !== 'receive') continue;
      if ((tx.confirmations ?? 0) < this.config.confirmations) continue;
      if (!tx.address || !tx.txid || Number(tx.amount) <= 0) continue;
      const user = await this.ledger.getUserByAddress(tx.address);
      if (!user) continue;
      const amount = toUnits(Number(tx.amount).toFixed(8));
      const result = await this.ledger.creditDeposit(user.discord_id, amount, tx.txid, tx.vout ?? 0);
      if (result.changes === 1n) console.log(`Credited ${fromUnits(amount)} YERB to ${user.discord_id}: ${tx.txid}`);
    }
  }

  async processOneWithdrawal() {
    const withdrawal = await this.ledger.claimPendingWithdrawal();
    if (!withdrawal) return;
    try {
      const validation = await this.rpc.validateAddress(withdrawal.address);
      if (!validation?.isvalid) throw new Error('Withdrawal address failed validation');
      const txid = await this.rpc.sendToAddress(withdrawal.address, Number(withdrawal.amount), `Discord withdrawal #${withdrawal.id}`);
      await this.ledger.markWithdrawalSent(withdrawal.id, txid);
      console.log(`Sent withdrawal #${withdrawal.id}: ${txid}`);
    } catch (error) {
      await this.ledger.markWithdrawalFailed(withdrawal.id, error.message);
      throw error;
    }
  }

  async processOneAssetWithdrawal() {
    const withdrawal = await this.ledger.claimPendingAssetWithdrawal();
    if (!withdrawal) return;
    try {
      const validation = await this.rpc.validateAddress(withdrawal.address);
      if (!validation?.isvalid) throw new Error('Asset withdrawal address failed validation');
      const result = await this.rpc.transferAsset(withdrawal.asset_name, Number(withdrawal.amount), withdrawal.address);
      const txid = Array.isArray(result) ? result[0] : result;
      if (!txid) throw new Error('Asset transfer RPC returned no transaction id');
      await this.ledger.markAssetWithdrawalSent(withdrawal.id, txid);
      console.log(`Sent asset withdrawal #${withdrawal.id}: ${txid}`);
    } catch (error) {
      await this.ledger.markAssetWithdrawalFailed(withdrawal.id, error.message);
      throw error;
    }
  }
}
