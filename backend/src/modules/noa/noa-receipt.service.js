'use strict';

const { randomUUID } = require('crypto');
const {
  NOA_FIAT_CURRENCY,
  NOA_SCALE,
  NOA_SETTING_KEYS,
  TOMAN_SCALE
} = require('./noa.constants');
const { divideFixed, formatFixed, parseFixed } = require('./fixed-point');
const {
  canonicalJson,
  digestValue,
  hashIdempotencyKey,
  normalizeMetadata,
  requireText,
  safeEqual,
  sha256
} = require('./noa.crypto');
const { noaError } = require('./noa.errors');

const RECEIPT_STATUSES = new Set(['pending', 'approved', 'rejected']);

const parseNoa = (value, field = 'amountNoa') =>
  parseFixed(value, {
    scale: NOA_SCALE,
    fieldName: field,
    allowZero: false,
    maxIntegerDigits: 18
  });

const parseToman = (value, field = 'tomanAmount') =>
  parseFixed(value, {
    scale: TOMAN_SCALE,
    fieldName: field,
    allowZero: false,
    maxIntegerDigits: 18
  });

function receiptDto(row, { includePrivate = false, replayed } = {}) {
  const dto = {
    receiptId: String(row.receipt_id),
    userId: String(row.user_id),
    declaredToman: row.declared_toman === null
      ? null
      : parseToman(String(row.declared_toman), 'declaredToman').value,
    verifiedToman: row.verified_toman === null
      ? null
      : parseToman(String(row.verified_toman), 'verifiedToman').value,
    exchangeRateSnapshot: row.exchange_rate_snapshot === null
      ? null
      : parseNoa(String(row.exchange_rate_snapshot), 'exchangeRateSnapshot').value,
    calculatedNoa: row.calculated_noa === null
      ? null
      : parseNoa(String(row.calculated_noa), 'calculatedNoa').value,
    approvedNoa: row.approved_noa === null
      ? null
      : parseNoa(String(row.approved_noa), 'approvedNoa').value,
    manualOverride: Boolean(row.manual_override),
    overrideReason: row.override_reason || null,
    status: String(row.status),
    originalFileName: row.original_file_name || null,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    reviewedByAdminId: row.reviewed_by_admin_id || null,
    reviewReason: row.review_reason || null,
    approvalTransactionId: row.approval_transaction_id || null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at || null,
    updatedAt: row.updated_at
  };
  if (includePrivate) {
    dto.storageKey = row.storage_key;
    dto.user = row.user_name
      ? { name: row.user_name, phone: row.user_phone || null }
      : undefined;
  }
  if (replayed !== undefined) dto.replayed = replayed;
  return dto;
}

function createNoaReceiptService({ repository, billingService }) {
  if (!repository || !billingService) {
    throw new TypeError('Receipt service requires repository and billingService');
  }

  function submissionPayloadHash({ fileSha256 }) {
    return sha256(Buffer.from(canonicalJson({
      fileSha256: Buffer.from(fileSha256).toString('hex')
    }), 'utf8'));
  }

  async function createUserReviewNotification({
    receipt,
    adminId,
    status,
    message,
    transactionId,
    connection
  }) {
    let notificationTransactionId = transactionId;

    // Notifications are intentionally tied to the financial ledger. A rejected
    // receipt has no credit transaction, so we create a zero-delta audit entry
    // rather than changing the user's balance or dropping the notification.
    if (!notificationTransactionId) {
      const wallet = await repository.getWalletById(receipt.wallet_id, {
        connection,
        forUpdate: true
      });
      if (!wallet) throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول پیدا نشد.', 500);
      const zero = formatFixed(0n, NOA_SCALE);
      notificationTransactionId = randomUUID();
      await repository.insertLog({
        transactionId: notificationTransactionId,
        walletId: wallet.wallet_id,
        reservationId: null,
        entryType: 'receipt_review_notice',
        amount: zero,
        availableDelta: zero,
        reservedDelta: zero,
        availableBefore: String(wallet.available_balance),
        availableAfter: String(wallet.available_balance),
        reservedBefore: String(wallet.reserved_balance),
        reservedAfter: String(wallet.reserved_balance),
        actionKey: null,
        referenceType: 'manual_receipt',
        referenceId: String(receipt.receipt_id),
        idempotencyHash: hashIdempotencyKey(`noa:receipt-review-notice:${receipt.receipt_id}:${status}`),
        payloadHash: digestValue(canonicalJson({
          receiptId: String(receipt.receipt_id),
          status,
          message
        })),
        actorType: 'admin',
        actorId: adminId,
        metadata: normalizeMetadata({
          receiptId: String(receipt.receipt_id),
          status,
          source: 'receipt_review_notification'
        })
      }, connection);
    }

    await repository.insertUserNotification({
      notificationId: randomUUID(),
      userId: String(receipt.user_id),
      transactionId: notificationTransactionId,
      message
    }, connection);
  }

  async function findSubmission({ userId, idempotencyKey, payloadHash }) {
    const normalizedUserId = requireText(userId, 'userId');
    const idempotencyHash = hashIdempotencyKey(idempotencyKey);
    const digest = digestValue(payloadHash);
    return repository.inTransaction(null, async (connection) => {
      await repository.ensureWallet(normalizedUserId, connection);
      const wallet = await repository.getWalletByUser(normalizedUserId, {
        connection,
        forUpdate: true
      });
      if (!wallet) throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول پیدا نشد.', 500);
      const existing = await repository.findReceiptBySubmitIdempotency(
        wallet.wallet_id,
        idempotencyHash,
        connection
      );
      if (!existing) return null;
      if (!safeEqual(existing.submit_payload_hash, digest)) {
        throw noaError(
          'NOA_IDEMPOTENCY_CONFLICT',
          'کلید تکرار برای رسید دیگری استفاده شده است.',
          409
        );
      }
      return receiptDto(existing, { replayed: true });
    });
  }

  async function submit(input) {
    const userId = requireText(input?.userId, 'userId');
    const storageKey = requireText(input?.storageKey, 'storageKey', 255);
    const originalFileName = requireText(
      input?.originalFileName || 'receipt',
      'originalFileName',
      255
    );
    const mimeType = requireText(input?.mimeType, 'mimeType', 64);
    const sizeBytes = Number(input?.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw noaError('NOA_RECEIPT_INVALID_FILE', 'اندازهٔ فایل رسید معتبر نیست.', 400);
    }
    const fileSha256 = digestValue(input?.fileSha256, 'fileSha256');
    const idempotencyHash = hashIdempotencyKey(input?.idempotencyKey);
    const payloadHash = submissionPayloadHash({
      fileSha256
    });

    return repository.inTransaction(input?.connection, async (connection) => {
      await repository.ensureWallet(userId, connection);
      const wallet = await repository.getWalletByUser(userId, {
        connection,
        forUpdate: true
      });
      if (!wallet) throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول پیدا نشد.', 500);

      const existing = await repository.findReceiptBySubmitIdempotency(
        wallet.wallet_id,
        idempotencyHash,
        connection
      );
      if (existing) {
        if (!safeEqual(existing.submit_payload_hash, payloadHash)) {
          throw noaError(
            'NOA_IDEMPOTENCY_CONFLICT',
            'کلید تکرار برای رسید دیگری استفاده شده است.',
            409
          );
        }
        return receiptDto(existing, { replayed: true });
      }
      const receiptId = randomUUID();
      // This opaque value keeps the original storage column compatible with
      // existing installations; it is server-generated and never requested
      // from, or exposed to, the user as a transaction identifier.
      const internalReference = `receipt:${receiptId}`;
      await repository.insertReceipt({
        receiptId,
        walletId: wallet.wallet_id,
        userId,
        transferReference: internalReference,
        transferReferenceHash: sha256(Buffer.from(internalReference, 'utf8')),
        declaredToman: null,
        storageKey,
        originalFileName,
        mimeType,
        sizeBytes,
        fileSha256,
        submitIdempotencyHash: idempotencyHash,
        submitPayloadHash: payloadHash
      }, connection);
      return receiptDto({
        receipt_id: receiptId,
        wallet_id: wallet.wallet_id,
        user_id: userId,
        transfer_reference: internalReference,
        declared_toman: null,
        verified_toman: null,
        exchange_rate_snapshot: null,
        calculated_noa: null,
        approved_noa: null,
        manual_override: 0,
        override_reason: null,
        status: 'pending',
        storage_key: storageKey,
        original_file_name: originalFileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        reviewed_by_admin_id: null,
        review_reason: null,
        approval_transaction_id: null,
        submitted_at: new Date(),
        reviewed_at: null,
        updated_at: new Date()
      }, { replayed: false });
    });
  }

  async function listForUser(userIdInput, options = {}) {
    const userId = requireText(userIdInput, 'userId');
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const rows = await repository.listUserReceipts(userId, {
      connection: options.connection,
      limit
    });
    return rows.map((row) => receiptDto(row));
  }

  async function getForUser(receiptIdInput, userIdInput, options = {}) {
    const receiptId = requireText(receiptIdInput, 'receiptId', 64);
    const userId = requireText(userIdInput, 'userId');
    const row = await repository.getReceiptById(receiptId, {
      connection: options.connection,
      userId
    });
    if (!row) throw noaError('NOA_RECEIPT_NOT_FOUND', 'رسید پیدا نشد.', 404);
    return row;
  }

  async function listForAdmin(options = {}) {
    const status = options.status ? String(options.status).trim().toLowerCase() : null;
    if (status && !RECEIPT_STATUSES.has(status)) {
      throw noaError('NOA_INVALID_RECEIPT_STATUS', 'وضعیت رسید معتبر نیست.', 400);
    }
    const page = Math.max(1, Number.parseInt(String(options.page || 1), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(String(options.pageSize || 20), 10) || 20)
    );
    const result = await repository.listAdminReceipts({
      connection: options.connection,
      status,
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    return {
      items: result.rows.map((row) => receiptDto(row, { includePrivate: true })),
      total: result.total,
      page,
      pageSize
    };
  }

  async function getForAdmin(receiptIdInput, options = {}) {
    const receiptId = requireText(receiptIdInput, 'receiptId', 64);
    const row = await repository.getReceiptById(receiptId, {
      connection: options.connection
    });
    if (!row) throw noaError('NOA_RECEIPT_NOT_FOUND', 'رسید پیدا نشد.', 404);
    return row;
  }

  async function approve(input) {
    const receiptId = requireText(input?.receiptId, 'receiptId', 64);
    const adminId = requireText(input?.adminId, 'adminId');
    const verifiedToman = parseToman(input?.verifiedToman, 'verifiedToman');
    const requestedApprovedNoa = input?.approvedNoa === undefined ||
      input?.approvedNoa === null ||
      input?.approvedNoa === ''
      ? null
      : parseNoa(input.approvedNoa, 'approvedNoa');
    const suppliedOverrideReason = typeof input?.overrideReason === 'string'
      ? input.overrideReason.trim()
      : '';
    const reviewReason = typeof input?.reviewReason === 'string'
      ? input.reviewReason.trim().slice(0, 500)
      : null;

    return repository.inTransaction(input?.connection, async (connection) => {
      const receipt = await repository.getReceiptById(receiptId, {
        connection,
        forUpdate: true
      });
      if (!receipt) throw noaError('NOA_RECEIPT_NOT_FOUND', 'رسید پیدا نشد.', 404);
      if (receipt.status === 'approved') {
        return receiptDto(receipt, { includePrivate: true, replayed: true });
      }
      if (receipt.status !== 'pending') {
        throw noaError(
          'NOA_RECEIPT_ALREADY_REVIEWED',
          'رسید قبلاً رد شده و قابل تأیید نیست.',
          409
        );
      }

      const rateRow = await repository.getSetting(NOA_SETTING_KEYS.TOMAN_PER_NOA, {
        connection,
        forUpdate: true
      });
      if (
        !rateRow ||
        !Boolean(Number(rateRow.is_active)) ||
        String(rateRow.fiat_currency).toUpperCase() !== NOA_FIAT_CURRENCY
      ) {
        throw noaError(
          'NOA_EXCHANGE_RATE_UNAVAILABLE',
          'نرخ تبدیل تومان به Noa در پایگاه داده فعال نیست.',
          503
        );
      }
      const exchangeRate = parseNoa(
        String(rateRow.decimal_value),
        'tomanPerNoa'
      );
      const calculatedNoa = divideFixed(verifiedToman, exchangeRate, NOA_SCALE);
      if (calculatedNoa.units <= 0n) {
        throw noaError('NOA_APPROVAL_AMOUNT_TOO_SMALL', 'مبلغ واریزی کمتر از حد قابل تبدیل است.', 400);
      }
      const approvedNoa = requestedApprovedNoa || calculatedNoa;
      const manualOverride = approvedNoa.units !== calculatedNoa.units;
      if (manualOverride && !suppliedOverrideReason) {
        throw noaError(
          'NOA_OVERRIDE_REASON_REQUIRED',
          'برای تغییر دستی مقدار Noa، دلیل الزامی است.',
          400,
          { field: 'overrideReason' }
        );
      }
      const overrideReason = manualOverride
        ? requireText(suppliedOverrideReason, 'overrideReason', 500)
        : null;
      const approvalPayload = canonicalJson({
        approvedNoa: approvedNoa.value,
        calculatedNoa: calculatedNoa.value,
        exchangeRate: exchangeRate.value,
        manualOverride,
        overrideReason,
        receiptId,
        verifiedToman: verifiedToman.value
      });
      const credit = await billingService.credit({
        userId: receipt.user_id,
        amountNoa: approvedNoa.value,
        entryType: 'receipt_credit',
        referenceType: 'manual_receipt',
        referenceId: receiptId,
        idempotencyKey: `noa:receipt-approval:${receiptId}`,
        payloadHash: approvalPayload,
        actorType: 'admin',
        actorId: adminId,
        metadata: {
          verifiedToman: verifiedToman.value,
          exchangeRate: exchangeRate.value,
          calculatedNoa: calculatedNoa.value,
          manualOverride,
          overrideReason
        }
      }, { connection });
      const updated = await repository.approveReceipt({
        receiptId,
        verifiedToman: verifiedToman.value,
        exchangeRate: exchangeRate.value,
        calculatedNoa: calculatedNoa.value,
        approvedNoa: approvedNoa.value,
        manualOverride,
        overrideReason,
        adminId,
        reviewReason,
        transactionId: credit.transactionId
      }, connection);
      if (!updated) {
        throw noaError('NOA_RECEIPT_REVIEW_RACE', 'وضعیت رسید همزمان تغییر کرده است.', 409);
      }
      await createUserReviewNotification({
        receipt,
        adminId,
        status: 'approved',
        transactionId: credit.transactionId,
        message: `رسید واریز شما تأیید شد و ${approvedNoa.value} نوآ به کیف پولتان اضافه شد.`,
        connection
      });
      return {
        ...receiptDto({
          ...receipt,
          verified_toman: verifiedToman.value,
          exchange_rate_snapshot: exchangeRate.value,
          calculated_noa: calculatedNoa.value,
          approved_noa: approvedNoa.value,
          manual_override: manualOverride ? 1 : 0,
          override_reason: overrideReason,
          status: 'approved',
          reviewed_by_admin_id: adminId,
          review_reason: reviewReason,
          approval_transaction_id: credit.transactionId,
          reviewed_at: new Date(),
          updated_at: new Date()
        }, { includePrivate: true, replayed: false }),
        wallet: credit.wallet
      };
    });
  }

  async function reject(input) {
    const receiptId = requireText(input?.receiptId, 'receiptId', 64);
    const adminId = requireText(input?.adminId, 'adminId');
    // Keep enough room for the explanatory prefix in the 500-character
    // user-notification payload while preserving a useful rejection reason.
    const reason = requireText(input?.reason, 'reason', 420);
    return repository.inTransaction(input?.connection, async (connection) => {
      const receipt = await repository.getReceiptById(receiptId, {
        connection,
        forUpdate: true
      });
      if (!receipt) throw noaError('NOA_RECEIPT_NOT_FOUND', 'رسید پیدا نشد.', 404);
      if (receipt.status === 'rejected') {
        return receiptDto(receipt, { includePrivate: true, replayed: true });
      }
      if (receipt.status !== 'pending') {
        throw noaError(
          'NOA_RECEIPT_ALREADY_REVIEWED',
          'رسید قبلاً تأیید شده و قابل رد نیست.',
          409
        );
      }
      const updated = await repository.rejectReceipt({
        receiptId,
        adminId,
        reason
      }, connection);
      if (!updated) {
        throw noaError('NOA_RECEIPT_REVIEW_RACE', 'وضعیت رسید همزمان تغییر کرده است.', 409);
      }
      await createUserReviewNotification({
        receipt,
        adminId,
        status: 'rejected',
        message: `رسید واریز شما رد شد. دلیل بررسی: ${reason}`,
        connection
      });
      return receiptDto({
        ...receipt,
        status: 'rejected',
        reviewed_by_admin_id: adminId,
        review_reason: reason,
        reviewed_at: new Date(),
        updated_at: new Date()
      }, { includePrivate: true, replayed: false });
    });
  }

  return {
    approve,
    findSubmission,
    getForAdmin,
    getForUser,
    listForAdmin,
    listForUser,
    reject,
    submissionPayloadHash,
    submit
  };
}

module.exports = {
  RECEIPT_STATUSES,
  createNoaReceiptService,
  receiptDto
};
