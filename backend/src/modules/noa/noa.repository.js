'use strict';

const { noaError } = require('./noa.errors');

const queryTarget = (connection, db) => connection || db;

function createNoaRepository(db) {
  if (!db || typeof db.query !== 'function' || typeof db.getConnection !== 'function') {
    throw new TypeError('Noa repository requires a database client with query and getConnection');
  }

  async function inTransaction(externalConnection, operation) {
    if (externalConnection) return operation(externalConnection);

    const retryableCodes = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const result = await operation(connection);
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection.rollback();
        } catch (_rollbackError) {
          // Preserve the original financial error.
        }
        if (!retryableCodes.has(error?.code) || attempt === maxAttempts) throw error;
      } finally {
        connection.release();
      }
    }
    throw new Error('Noa transaction retry loop ended unexpectedly.');
  }

  async function getPricing(actionKey, { connection, forUpdate = false } = {}) {
    const [rows] = await queryTarget(connection, db).query(
      `SELECT action_key, unit, unit_price, is_active, version, updated_by_admin_id, updated_at
         FROM app_noa_pricing_configs
        WHERE action_key = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [actionKey]
    );
    return rows[0] || null;
  }

  async function listPricing({ connection } = {}) {
    const [rows] = await queryTarget(connection, db).query(
      `SELECT action_key, unit, unit_price, is_active, version, updated_by_admin_id, updated_at
         FROM app_noa_pricing_configs
        ORDER BY FIELD(action_key, 'text_chat', 'image_generation', 'video_generation'), action_key`
    );
    return rows;
  }

  async function updatePricing({ actionKey, unitPrice, adminId, currentVersion, isActive }, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_pricing_configs
          SET unit_price = ?, is_active = ?, version = version + 1,
              updated_by_admin_id = ?, updated_at = CURRENT_TIMESTAMP(6)
        WHERE action_key = ? AND version = ?`,
      [unitPrice, isActive ? 1 : 0, adminId, actionKey, currentVersion]
    );
    return result.affectedRows === 1;
  }

  async function getSetting(settingKey, { connection, forUpdate = false } = {}) {
    const [rows] = await queryTarget(connection, db).query(
      `SELECT setting_key, decimal_value, fiat_currency, is_active, version,
              updated_by_admin_id, updated_at
         FROM app_noa_settings
        WHERE setting_key = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [settingKey]
    );
    return rows[0] || null;
  }

  async function updateSetting({ settingKey, decimalValue, adminId, currentVersion }, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_settings
          SET decimal_value = ?, version = version + 1,
              updated_by_admin_id = ?, updated_at = CURRENT_TIMESTAMP(6)
        WHERE setting_key = ? AND version = ? AND is_active = 1`,
      [decimalValue, adminId, settingKey, currentVersion]
    );
    return result.affectedRows === 1;
  }

  async function ensureWallet(userId, connection) {
    try {
      await connection.query(
        `INSERT IGNORE INTO app_noa_wallets
          (user_id, available_balance, reserved_balance, version, created_at, updated_at)
         VALUES (?, '0.000000', '0.000000', 0, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
        [userId]
      );
    } catch (error) {
      if (error?.code === 'ER_NO_REFERENCED_ROW_2' || error?.errno === 1452) {
        throw noaError('NOA_USER_NOT_FOUND', 'حساب کاربری معتبر نیست.', 401);
      }
      throw error;
    }
  }

  async function getWalletByUser(userId, { connection, forUpdate = false } = {}) {
    const [rows] = await queryTarget(connection, db).query(
      `SELECT wallet_id, user_id, available_balance, reserved_balance, version, updated_at
         FROM app_noa_wallets
        WHERE user_id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [userId]
    );
    return rows[0] || null;
  }

  async function getWalletById(walletId, { connection, forUpdate = false } = {}) {
    const [rows] = await queryTarget(connection, db).query(
      `SELECT wallet_id, user_id, available_balance, reserved_balance, version, updated_at
         FROM app_noa_wallets
        WHERE wallet_id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [walletId]
    );
    return rows[0] || null;
  }

  async function findReservationByIdempotency(walletId, idempotencyHash, connection) {
    const [rows] = await connection.query(
      `SELECT reservation_id, wallet_id, user_id, action_key, unit, quantity,
              unit_price_snapshot, pricing_version, amount, idempotency_key_hash,
              payload_hash, reference_type, reference_id, status, expires_at,
              captured_at, released_at, release_reason, created_at, updated_at
         FROM app_noa_reservations
        WHERE wallet_id = ? AND idempotency_key_hash = ?
        LIMIT 1
        FOR UPDATE`,
      [walletId, idempotencyHash]
    );
    return rows[0] || null;
  }

  async function findReservationLocator(reservationId, connection) {
    const [rows] = await connection.query(
      `SELECT reservation_id, wallet_id
         FROM app_noa_reservations
        WHERE reservation_id = ?
        LIMIT 1`,
      [reservationId]
    );
    return rows[0] || null;
  }

  async function findReservationById(reservationId, connection, forUpdate = false) {
    const [rows] = await connection.query(
      `SELECT reservation_id, wallet_id, user_id, action_key, unit, quantity,
              unit_price_snapshot, pricing_version, amount, idempotency_key_hash,
              payload_hash, reference_type, reference_id, status, expires_at,
              captured_at, released_at, release_reason, created_at, updated_at
         FROM app_noa_reservations
        WHERE reservation_id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [reservationId]
    );
    return rows[0] || null;
  }

  async function insertReservation(record, connection) {
    await connection.query(
      `INSERT INTO app_noa_reservations
        (reservation_id, wallet_id, user_id, action_key, unit, quantity,
         unit_price_snapshot, pricing_version, amount, idempotency_key_hash,
         payload_hash, reference_type, reference_id, status, expires_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?,
               CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        record.reservationId,
        record.walletId,
        record.userId,
        record.actionKey,
        record.unit,
        record.quantity,
        record.unitPrice,
        record.pricingVersion,
        record.amount,
        record.idempotencyHash,
        record.payloadHash,
        record.referenceType,
        record.referenceId,
        record.expiresAt
      ]
    );
  }

  async function reserveWallet(walletId, amount, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_wallets
          SET available_balance = available_balance - ?,
              reserved_balance = reserved_balance + ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP(6)
        WHERE wallet_id = ? AND available_balance >= ?`,
      [amount, amount, walletId, amount]
    );
    return result.affectedRows === 1;
  }

  async function captureWallet(walletId, amount, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_wallets
          SET reserved_balance = reserved_balance - ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP(6)
        WHERE wallet_id = ? AND reserved_balance >= ?`,
      [amount, walletId, amount]
    );
    return result.affectedRows === 1;
  }

  async function releaseWallet(walletId, amount, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_wallets
          SET available_balance = available_balance + ?,
              reserved_balance = reserved_balance - ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP(6)
        WHERE wallet_id = ? AND reserved_balance >= ?`,
      [amount, amount, walletId, amount]
    );
    return result.affectedRows === 1;
  }

  async function creditWallet(walletId, amount, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_wallets
          SET available_balance = available_balance + ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP(6)
        WHERE wallet_id = ?`,
      [amount, walletId]
    );
    return result.affectedRows === 1;
  }

  async function transitionReservation(reservationId, fromStatus, toStatus, reason, connection) {
    const timestampColumn = toStatus === 'captured' ? 'captured_at' : 'released_at';
    const [result] = await connection.query(
      `UPDATE app_noa_reservations
          SET status = ?, ${timestampColumn} = CURRENT_TIMESTAMP(6),
              release_reason = ?, updated_at = CURRENT_TIMESTAMP(6)
        WHERE reservation_id = ? AND status = ?`,
      [toStatus, toStatus === 'released' ? reason : null, reservationId, fromStatus]
    );
    return result.affectedRows === 1;
  }

  async function findLogByIdempotency(walletId, idempotencyHash, entryType, connection) {
    const [rows] = await connection.query(
      `SELECT transaction_id, wallet_id, reservation_id, entry_type, amount,
              available_delta, reserved_delta, available_before, available_after,
              reserved_before, reserved_after, action_key, reference_type,
              reference_id, idempotency_key_hash, payload_hash, actor_type,
              actor_id, metadata, created_at
         FROM app_noa_transaction_logs
        WHERE wallet_id = ? AND idempotency_key_hash = ? AND entry_type = ?
        LIMIT 1
        FOR UPDATE`,
      [walletId, idempotencyHash, entryType]
    );
    return rows[0] || null;
  }

  async function insertLog(record, connection) {
    await connection.query(
      `INSERT INTO app_noa_transaction_logs
        (transaction_id, wallet_id, reservation_id, entry_type, amount,
         available_delta, reserved_delta, available_before, available_after,
         reserved_before, reserved_after, action_key, reference_type, reference_id,
         idempotency_key_hash, payload_hash, actor_type, actor_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               CURRENT_TIMESTAMP(6))`,
      [
        record.transactionId,
        record.walletId,
        record.reservationId || null,
        record.entryType,
        record.amount,
        record.availableDelta,
        record.reservedDelta,
        record.availableBefore,
        record.availableAfter,
        record.reservedBefore,
        record.reservedAfter,
        record.actionKey || null,
        record.referenceType,
        record.referenceId,
        record.idempotencyHash,
        record.payloadHash,
        record.actorType,
        record.actorId || null,
        record.metadata
      ]
    );
  }

  async function listTransactions(userId, { limit = 50, before, connection } = {}) {
    const params = [userId];
    let cursorClause = '';
    if (before) {
      cursorClause = 'AND (l.created_at < ? OR (l.created_at = ? AND l.transaction_id < ?))';
      params.push(before.createdAt, before.createdAt, before.transactionId);
    }
    params.push(limit);
    const [rows] = await queryTarget(connection, db).query(
      `SELECT l.transaction_id, l.reservation_id, l.entry_type, l.amount,
              l.available_delta, l.reserved_delta, l.action_key, l.reference_type,
              l.reference_id, l.actor_type, l.metadata, l.created_at
         FROM app_noa_transaction_logs l
         INNER JOIN app_noa_wallets w ON w.wallet_id = l.wallet_id
        WHERE w.user_id = ? ${cursorClause}
        ORDER BY l.created_at DESC, l.transaction_id DESC
        LIMIT ?`,
      params
    );
    return rows;
  }

  async function listExpiredReservationIds({ limit = 100, connection } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const [rows] = await queryTarget(connection, db).query(
      `SELECT reservation_id
         FROM app_noa_reservations
        WHERE status = 'reserved'
          AND expires_at IS NOT NULL
          AND expires_at <= CURRENT_TIMESTAMP(6)
        ORDER BY expires_at ASC, reservation_id ASC
        LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => String(row.reservation_id));
  }

  const receiptColumns = `
    receipt_id, wallet_id, user_id, transfer_reference, transfer_reference_hash,
    declared_toman, verified_toman, exchange_rate_snapshot, calculated_noa,
    approved_noa, manual_override, override_reason, status, storage_key,
    original_file_name, mime_type, size_bytes, file_sha256,
    submit_idempotency_hash, submit_payload_hash, reviewed_by_admin_id,
    review_reason, approval_transaction_id, submitted_at, reviewed_at, updated_at
  `;

  async function findReceiptBySubmitIdempotency(
    walletId,
    idempotencyHash,
    connection,
    forUpdate = true
  ) {
    const [rows] = await connection.query(
      `SELECT ${receiptColumns}
         FROM app_noa_receipts
        WHERE wallet_id = ? AND submit_idempotency_hash = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [walletId, idempotencyHash]
    );
    return rows[0] || null;
  }

  async function insertReceipt(record, connection) {
    await connection.query(
      `INSERT INTO app_noa_receipts
        (receipt_id, wallet_id, user_id, transfer_reference,
         transfer_reference_hash, declared_toman, status, storage_key,
         original_file_name, mime_type, size_bytes, file_sha256,
         submit_idempotency_hash, submit_payload_hash, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?,
               CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        record.receiptId,
        record.walletId,
        record.userId,
        record.transferReference,
        record.transferReferenceHash,
        record.declaredToman,
        record.storageKey,
        record.originalFileName,
        record.mimeType,
        record.sizeBytes,
        record.fileSha256,
        record.submitIdempotencyHash,
        record.submitPayloadHash
      ]
    );
  }

  async function getReceiptById(
    receiptId,
    { connection, forUpdate = false, userId = null } = {}
  ) {
    const params = [receiptId];
    const userClause = userId ? ' AND user_id = ?' : '';
    if (userId) params.push(userId);
    const [rows] = await queryTarget(connection, db).query(
      `SELECT ${receiptColumns}
         FROM app_noa_receipts
        WHERE receipt_id = ?${userClause}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      params
    );
    return rows[0] || null;
  }

  async function listUserReceipts(userId, { connection, limit = 50 } = {}) {
    const [rows] = await queryTarget(connection, db).query(
      `SELECT ${receiptColumns}
         FROM app_noa_receipts
        WHERE user_id = ?
        ORDER BY submitted_at DESC, receipt_id DESC
        LIMIT ?`,
      [userId, limit]
    );
    return rows;
  }

  async function listAdminReceipts({ connection, status, limit, offset }) {
    const params = [];
    const statusClause = status ? 'WHERE r.status = ?' : '';
    if (status) params.push(status);
    const [countRows] = await queryTarget(connection, db).query(
      `SELECT COUNT(*) AS total FROM app_noa_receipts r ${statusClause}`,
      params
    );
    const [rows] = await queryTarget(connection, db).query(
      `SELECT ${receiptColumns.split(',').map((column) => `r.${column.trim()}`).join(', ')},
              u.name AS user_name, u.phone AS user_phone
         FROM app_noa_receipts r
         INNER JOIN app_users u ON u.user_id = r.user_id
         ${statusClause}
        ORDER BY r.submitted_at DESC, r.receipt_id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { rows, total: Number(countRows[0]?.total || 0) };
  }

  async function approveReceipt(record, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_receipts
          SET verified_toman = ?, exchange_rate_snapshot = ?, calculated_noa = ?,
              approved_noa = ?, manual_override = ?, override_reason = ?,
              status = 'approved', reviewed_by_admin_id = ?, review_reason = ?,
              approval_transaction_id = ?, reviewed_at = CURRENT_TIMESTAMP(6),
              updated_at = CURRENT_TIMESTAMP(6)
        WHERE receipt_id = ? AND status = 'pending'`,
      [
        record.verifiedToman,
        record.exchangeRate,
        record.calculatedNoa,
        record.approvedNoa,
        record.manualOverride ? 1 : 0,
        record.overrideReason,
        record.adminId,
        record.reviewReason,
        record.transactionId,
        record.receiptId
      ]
    );
    return result.affectedRows === 1;
  }

  async function rejectReceipt(record, connection) {
    const [result] = await connection.query(
      `UPDATE app_noa_receipts
          SET status = 'rejected', reviewed_by_admin_id = ?, review_reason = ?,
              reviewed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
        WHERE receipt_id = ? AND status = 'pending'`,
      [record.adminId, record.reason, record.receiptId]
    );
    return result.affectedRows === 1;
  }

  return {
    approveReceipt,
    captureWallet,
    creditWallet,
    ensureWallet,
    findLogByIdempotency,
    findReceiptBySubmitIdempotency,
    findReservationById,
    findReservationByIdempotency,
    findReservationLocator,
    getPricing,
    getReceiptById,
    getSetting,
    getWalletById,
    getWalletByUser,
    inTransaction,
    insertLog,
    insertReceipt,
    insertReservation,
    listAdminReceipts,
    listExpiredReservationIds,
    listPricing,
    listTransactions,
    listUserReceipts,
    rejectReceipt,
    releaseWallet,
    reserveWallet,
    transitionReservation,
    updatePricing,
    updateSetting
  };
}

module.exports = { createNoaRepository };
