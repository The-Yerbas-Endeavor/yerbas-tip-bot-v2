export class YerbasRpc {
  constructor(config) {
    this.url = config.url;
    this.username = config.username;
    this.password = config.password;
    this.timeoutMs = config.timeoutMs;
    this.nextId = 1;
  }

  async call(method, params = []) {
    if (!this.username || !this.password) {
      throw new Error('Yerbas RPC credentials are not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ jsonrpc: '1.0', id: this.nextId++, method, params }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Yerbas RPC HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
      return payload.result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`Yerbas RPC timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getBlockCount() { return this.call('getblockcount'); }
  getNetworkInfo() { return this.call('getnetworkinfo'); }
  getWalletInfo() { return this.call('getwalletinfo'); }
  validateAddress(address) { return this.call('validateaddress', [address]); }
  getNewAddress(label) { return this.call('getnewaddress', [label]); }
  getRawTransaction(txid, verbose = true) { return this.call('getrawtransaction', [txid, verbose]); }
  listTransactions(label = '*', count = 1000, skip = 0) { return this.call('listtransactions', [label, count, skip, true]); }
  sendToAddress(address, amount, comment = '') { return this.call('sendtoaddress', [address, amount, comment]); }

  getAssetData(assetName) { return this.call('getassetdata', [assetName]); }
  listMyAssets(filter = '*', verbose = false, count = 500, start = 0) {
    return this.call('listmyassets', [filter, verbose, count, start]);
  }
  listAssetBalancesByAddress(address, onlyTotal = false, count = 500, start = 0) {
    return this.call('listassetbalancesbyaddress', [address, onlyTotal, count, start]);
  }
  transferAsset(assetName, amount, address, message = '', expireTime = 0, yerbChangeAddress = '', assetChangeAddress = '') {
    return this.call('transfer', [assetName, amount, address, message, expireTime, yerbChangeAddress, assetChangeAddress]);
  }
  transferAssetFromAddress(assetName, fromAddress, amount, address, message = '', expireTime = 0, yerbChangeAddress = '', assetChangeAddress = '') {
    return this.call('transferfromaddress', [assetName, fromAddress, amount, address, message, expireTime, yerbChangeAddress, assetChangeAddress]);
  }
}
