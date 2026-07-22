-- Yerbas Tip Bot v2 non-destructive migration
-- Run this against a COPY of the legacy database first.

CREATE TABLE IF NOT EXISTS v2_withdrawal_queue (
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
  PRIMARY KEY (id),
  KEY idx_v2_withdrawal_status (status),
  KEY idx_v2_withdrawal_discord (discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v2_asset_balances (
  discord_id VARCHAR(60) NOT NULL,
  asset_name VARCHAR(64) NOT NULL,
  balance DECIMAL(32,8) NOT NULL DEFAULT 0.00000000,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (discord_id, asset_name),
  KEY idx_v2_asset_name (asset_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v2_asset_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_name VARCHAR(64) NOT NULL,
  amount DECIMAL(32,8) NOT NULL,
  from_discord_id VARCHAR(60) NOT NULL,
  to_discord_id VARCHAR(60) NOT NULL,
  type VARCHAR(32) NOT NULL,
  reference VARCHAR(128) NOT NULL,
  metadata JSON DEFAULT NULL,
  datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_v2_asset_payment_reference (asset_name, type, reference, from_discord_id, to_discord_id),
  KEY idx_v2_asset_payment_from (from_discord_id),
  KEY idx_v2_asset_payment_to (to_discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v2_asset_withdrawal_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discord_id VARCHAR(60) NOT NULL,
  asset_name VARCHAR(64) NOT NULL,
  address VARCHAR(60) NOT NULL,
  amount DECIMAL(32,8) NOT NULL,
  status ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  txid VARCHAR(64) DEFAULT NULL,
  error TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v2_asset_withdrawal_status (status),
  KEY idx_v2_asset_withdrawal_discord (discord_id),
  KEY idx_v2_asset_withdrawal_name (asset_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v2_processed_events (
  event_type VARCHAR(32) NOT NULL,
  event_key VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_type, event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
