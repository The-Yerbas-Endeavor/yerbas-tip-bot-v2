import { toUnits, fromUnits } from './ledger.js';

function outputAddress(output) {
  const script = output?.scriptPubKey ?? {};
  if (typeof script.address === 'string' && script.address) return script.address;
  if (Array.isArray(script.addresses) && script.addresses.length) return script.addresses[0];
  return null;
}

function assetOutpoints(assetData) {
  if (!assetData || typeof assetData !== 'object') return [];
  if (Array.isArray(assetData.outpoints)) return assetData.outpoints;
  if (Array.isArray(assetData.outputs)) return assetData.outputs;
  return [];
}

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
      await this.reconcileYerbDeposits();
      if (this.config.assetsEnabled) await this.reconcileAssetDeposits();
      if (this.config.withdrawalsEnabled) await this.processOneWithdrawal();
      if (this.config.assetsEnabled && this.config.assetWithdrawalsEnabled) await this.processOneAssetWithdrawal();
    } finally {
      this.running = false;
    }
  }

  async reconcileYerbDeposits() {
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

  async reconcileAssetDeposits() {
    const assets = await this.rpc.listMyAssets('*', true, 500, 0);
    for (const [assetName, assetData] of Object.entries(assets || {})) {
      for (const outpoint of assetOutpoints(assetData)) {
        const txid = outpoint.txid ?? outpoint.tx_hash;
        const vout = Number(outpoint.vout ?? outpoint.n ?? 0);
        const amountValue = Number(outpoint.amount ?? outpoint.qty ?? outpoint.value);
        if (!txid || !Number.isInteger(vout) || vout < 0 || !Number.isFinite(amountValue) || amountValue <= 0) continue;

        const tx = await this.rpc.getRawTransaction(txid, true);
        if ((tx?.confirmations ?? 0) < this.config.confirmations) continue;
        const output = Array.isArray(tx?.vout) ? tx.vout.find((item) => Number(item.n) === vout) : null;
        const address = outputAddress(output);
        if (!address) continue;
        const user = await this.ledger.getUserByAddress(address);
        if (!user) continue;

        const amount = toUnits(amountValue.toFixed(8));
        const reference = `${txid}:${vout}`;
        const result = await this.ledger.addAssetCredit(
          user.discord_id,
          assetName,
          amount,
          'asset_deposit',
          reference,
          { txid, vout, address, confirmations: tx.confirmations ?? 0 }
        );
        if (result.changes === 1n) {
          console.log(`Credited ${fromUnits(amount)} ${assetName} to ${user.discord_id}: ${reference}`);
        }
      }
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
