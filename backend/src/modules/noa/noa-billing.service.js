'use strict';

const { randomUUID } = require('crypto');
const {
  NOA_ACTION_KEYS,
  NOA_ACTIONS,
  NOA_CURRENCY,
  NOA_FIAT_CURRENCY,
  NOA_SCALE,
  NOA_SETTING_KEYS
} = require('./noa.constants');
const {
  addFixed,
  formatFixed,
  multiplyFixed,
  parseFixed
} = require('./fixed-point');
const {
  digestValue,
  hashIdempotencyKey,
  normalizeMetadata,
  requireText,
  safeEqual
} = require('./noa.crypto');
const { noaError } = require('./noa.errors');
const { PAYMENT_GATEWAY_ENABLED } = require('./payment-gateway');

const ACTOR_TYPES = new Set(['user', 'admin', 'system', 'gateway']);
const RESERVATION_STATUSES = new Set(['reserved', 'captured', 'released']);

const decimal = (value, field, options = {}) =>
  parseFixed(value, {
    scale: NOA_SCALE,
    fieldName: field,
    maxIntegerDigits: 18,
    ...options
  });

function booleanFromDb(value) {
  return value === true || value === 1 || value === '1';
}

function normalizeActionKey(value) {
  const actionKey = requireText(value, 'actionKey', 64);
  if (!NOA_ACTION_KEYS.includes(actionKey)) {
    throw noaError('NOA_UNKNOWN_ACTION', 'عملیات Noa پشتیبانی نمی‌شود.', 400, {
      actionKey
    });
  }
  return actionKey;
}

function normalizeActor(value, fallback = 'system') {
  const actorType = value === undefined ? fallback : String(value).trim().toLowerCase();
  if (!ACTOR_TYPES.has(actorType)) {
    throw noaError('NOA_INVALID_ACTOR', 'نوع عامل تراکنش معتبر نیست.', 400);
  }
  return actorType;
}

function normalizeQuantity(actionKey, value) {
  const quantity = decimal(value ?? '1', 'quantity', { allowZero: false });
  const one = decimal('1', 'quantity');

  if (
    (actionKey === NOA_ACTIONS.TEXT_CHAT || actionKey === NOA_ACTIONS.IMAGE_GENERATION) &&
    quantity.units !== one.units
  ) {
    throw noaError(
      'NOA_INVALID_QUANTITY',
      'هزینهٔ پیام و تصویر فقط برای یک عملیات کامل محاسبه می‌شود.',
      400,
      { actionKey }
    );
  }

  if (
    actionKey === NOA_ACTIONS.VIDEO_GENERATION &&
    quantity.units % (10n ** BigInt(NOA_SCALE)) !== 0n
  ) {
    throw noaError(
      'NOA_INVALID_VIDEO_DURATION',
      'مدت ویدئو باید تعداد صحیحی از ثانیه‌ها باشد.',
      400
    );
  }
  return quantity;
}

function normalizeExpiry(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw noaError('NOA_INVALID_EXPIRY', 'زمان انقضای رزرو معتبر نیست.', 400);
  }
  return date;
}

function walletDto(row) {
  const available = decimal(String(row.available_balance), 'availableBalance', {
    allowNegative: false
  });
  const reserved = decimal(String(row.reserved_balance), 'reservedBalance', {
    allowNegative: false
  });
  const total = addFixed(available, reserved);
  return {
    walletId: String(row.wallet_id),
    userId: String(row.user_id),
    currency: NOA_CURRENCY,
    balanceNoa: available.value,
    availableNoa: available.value,
    availableBalanceNoa: available.value,
    reservedNoa: reserved.value,
    reservedBalanceNoa: reserved.value,
    totalNoa: total.value,
    version: Number(row.version || 0),
    updatedAt: row.updated_at || null
  };
}

function pricingDto(row) {
  return {
    actionKey: String(row.action_key),
    unit: String(row.unit),
    unitPriceNoa: decimal(String(row.unit_price), 'unitPriceNoa', {
      allowZero: false
    }).value,
    isActive: booleanFromDb(row.is_active),
    version: Number(row.version),
    updatedByAdminId: row.updated_by_admin_id || null,
    updatedAt: row.updated_at || null
  };
}

function reservationDto(row, extras = {}) {
  return {
    reservationId: String(row.reservation_id),
    userId: String(row.user_id),
    actionKey: String(row.action_key),
    unit: String(row.unit),
    quantity: decimal(String(row.quantity), 'quantity', { allowZero: false }).value,
    unitPriceNoa: decimal(String(row.unit_price_snapshot), 'unitPriceNoa', {
      allowZero: false
    }).value,
    pricingVersion: Number(row.pricing_version),
    amountNoa: decimal(String(row.amount), 'amountNoa', { allowZero: false }).value,
    status: RESERVATION_STATUSES.has(row.status) ? row.status : String(row.status),
    referenceType: String(row.reference_type),
    referenceId: String(row.reference_id),
    expiresAt: row.expires_at || null,
    capturedAt: row.captured_at || null,
    releasedAt: row.released_at || null,
    releaseReason: row.release_reason || null,
    ...extras
  };
}

function parseExpectedVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw noaError('NOA_INVALID_VERSION', 'نسخهٔ تنظیم معتبر نیست.', 400);
  }
  return parsed;
}

function createNoaBillingService({ repository }) {
  if (!repository || typeof repository.inTransaction !== 'function') {
    throw new TypeError('Noa billing service requires a Noa repository');
  }

  async function readActivePricing(actionKey, options = {}) {
    const row = await repository.getPricing(actionKey, options);
    if (!row || !booleanFromDb(row.is_active)) {
      throw noaError(
        'NOA_PRICING_UNAVAILABLE',
        'قیمت این عملیات در پایگاه داده فعال نیست.',
        503,
        { actionKey }
      );
    }
    return row;
  }

  async function quote(input, options = {}) {
    const actionKey = normalizeActionKey(input?.actionKey);
    const quantity = normalizeQuantity(actionKey, input?.quantity);
    const row = await readActivePricing(actionKey, {
      connection: options.connection,
      forUpdate: Boolean(options.connection)
    });
    const price = decimal(String(row.unit_price), 'unitPriceNoa', { allowZero: false });
    const amount = multiplyFixed(price, quantity, NOA_SCALE);
    if (amount.units <= 0n) {
      throw noaError('NOA_INVALID_PRICE', 'قیمت محاسبه‌شده معتبر نیست.', 503);
    }
    return {
      actionKey,
      unit: String(row.unit),
      quantity: quantity.value,
      unitPriceNoa: price.value,
      amountNoa: amount.value,
      pricingVersion: Number(row.version)
    };
  }

  async function reserve(input, options = {}) {
    const userId = requireText(input?.userId, 'userId');
    const actionKey = normalizeActionKey(input?.actionKey);
    const quantity = normalizeQuantity(actionKey, input?.quantity);
    const idempotencyHash = hashIdempotencyKey(input?.idempotencyKey);
    const payloadHash = digestValue(input?.payloadHash, 'payloadHash');
    const referenceType = requireText(input?.referenceType, 'referenceType', 64);
    const referenceId = requireText(input?.referenceId, 'referenceId');
    const expiresAt = normalizeExpiry(input?.expiresAt);
    const actorType = normalizeActor(input?.actorType, 'user');
    const actorId = input?.actorId
      ? requireText(String(input.actorId), 'actorId')
      : (actorType === 'user' ? userId : null);
    const metadata = normalizeMetadata(input?.metadata);

    return repository.inTransaction(options.connection, async (connection) => {
      await repository.ensureWallet(userId, connection);
      const wallet = await repository.getWalletByUser(userId, {
        connection,
        forUpdate: true
      });
      if (!wallet) throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول پیدا نشد.', 500);

      const existing = await repository.findReservationByIdempotency(
        wallet.wallet_id,
        idempotencyHash,
        connection
      );
      if (existing) {
        const sameRequest =
          safeEqual(existing.payload_hash, payloadHash) &&
          String(existing.action_key) === actionKey &&
          decimal(String(existing.quantity), 'quantity').units === quantity.units &&
          String(existing.reference_type) === referenceType &&
          String(existing.reference_id) === referenceId;
        if (!sameRequest) {
          throw noaError(
            'NOA_IDEMPOTENCY_CONFLICT',
            'کلید تکرار با درخواست دیگری استفاده شده است.',
            409
          );
        }
        return reservationDto(existing, { replayed: true, changed: false });
      }

      const pricing = await readActivePricing(actionKey, {
        connection,
        forUpdate: true
      });
      const unitPrice = decimal(String(pricing.unit_price), 'unitPriceNoa', {
        allowZero: false
      });
      const amount = multiplyFixed(unitPrice, quantity, NOA_SCALE);
      const availableBefore = decimal(
        String(wallet.available_balance),
        'availableBalance'
      );
      const reservedBefore = decimal(
        String(wallet.reserved_balance),
        'reservedBalance'
      );
      if (availableBefore.units < amount.units) {
        throw noaError(
          'NOA_INSUFFICIENT_FUNDS',
          'موجودی Noa برای انجام این عملیات کافی نیست.',
          402,
          {
            balanceNoa: availableBefore.value,
            requiredNoa: amount.value,
            shortfallNoa: formatFixed(amount.units - availableBefore.units, NOA_SCALE)
          }
        );
      }

      const reservationId = randomUUID();
      const didReserve = await repository.reserveWallet(
        wallet.wallet_id,
        amount.value,
        connection
      );
      if (!didReserve) {
        throw noaError(
          'NOA_INSUFFICIENT_FUNDS',
          'موجودی Noa برای انجام این عملیات کافی نیست.',
          402,
          { balanceNoa: availableBefore.value, requiredNoa: amount.value }
        );
      }

      await repository.insertReservation({
        reservationId,
        walletId: wallet.wallet_id,
        userId,
        actionKey,
        unit: pricing.unit,
        quantity: quantity.value,
        unitPrice: unitPrice.value,
        pricingVersion: Number(pricing.version),
        amount: amount.value,
        idempotencyHash,
        payloadHash,
        referenceType,
        referenceId,
        expiresAt
      }, connection);

      const availableAfter = formatFixed(
        availableBefore.units - amount.units,
        NOA_SCALE
      );
      const reservedAfter = formatFixed(
        reservedBefore.units + amount.units,
        NOA_SCALE
      );
      await repository.insertLog({
        transactionId: randomUUID(),
        walletId: wallet.wallet_id,
        reservationId,
        entryType: 'reserve',
        amount: amount.value,
        availableDelta: formatFixed(-amount.units, NOA_SCALE),
        reservedDelta: amount.value,
        availableBefore: availableBefore.value,
        availableAfter,
        reservedBefore: reservedBefore.value,
        reservedAfter,
        actionKey,
        referenceType,
        referenceId,
        idempotencyHash,
        payloadHash,
        actorType,
        actorId,
        metadata
      }, connection);

      return {
        reservationId,
        userId,
        actionKey,
        unit: String(pricing.unit),
        quantity: quantity.value,
        unitPriceNoa: unitPrice.value,
        pricingVersion: Number(pricing.version),
        amountNoa: amount.value,
        status: 'reserved',
        referenceType,
        referenceId,
        expiresAt,
        capturedAt: null,
        releasedAt: null,
        releaseReason: null,
        replayed: false,
        changed: true
      };
    });
  }

  function normalizeTransitionArgs(reservationOrInput, rawOptions) {
    if (
      reservationOrInput &&
      typeof reservationOrInput === 'object' &&
      !Buffer.isBuffer(reservationOrInput)
    ) {
      return {
        reservationId: requireText(
          reservationOrInput.reservationId,
          'reservationId',
          64
        ),
        options: { ...reservationOrInput, ...rawOptions }
      };
    }
    return {
      reservationId: requireText(reservationOrInput, 'reservationId', 64),
      options: rawOptions || {}
    };
  }

  async function transitionReservation(reservationOrInput, rawOptions, targetStatus) {
    const normalized = normalizeTransitionArgs(reservationOrInput, rawOptions);
    const reservationId = normalized.reservationId;
    const options = normalized.options;
    const actorType = normalizeActor(options.actorType, 'system');
    const actorId = options.actorId
      ? requireText(String(options.actorId), 'actorId')
      : null;
    const metadata = normalizeMetadata(options.metadata);
    const releaseReason = targetStatus === 'released'
      ? requireText(options.reason || 'operation_failed', 'reason', 191)
      : null;

    return repository.inTransaction(options.connection, async (connection) => {
      const locator = await repository.findReservationLocator(reservationId, connection);
      if (!locator) {
        throw noaError('NOA_RESERVATION_NOT_FOUND', 'رزرو Noa پیدا نشد.', 404);
      }

      const wallet = await repository.getWalletById(locator.wallet_id, {
        connection,
        forUpdate: true
      });
      if (!wallet) {
        throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول رزرو پیدا نشد.', 500);
      }

      const reservation = await repository.findReservationById(
        reservationId,
        connection,
        true
      );
      if (!reservation) {
        throw noaError('NOA_RESERVATION_NOT_FOUND', 'رزرو Noa پیدا نشد.', 404);
      }
      if (options.userId && String(reservation.user_id) !== String(options.userId)) {
        throw noaError('NOA_RESERVATION_FORBIDDEN', 'دسترسی به این رزرو مجاز نیست.', 403);
      }

      if (reservation.status === targetStatus) {
        return reservationDto(reservation, { replayed: true, changed: false });
      }
      if (reservation.status !== 'reserved') {
        throw noaError(
          'NOA_RESERVATION_FINALIZED',
          `رزرو قبلاً ${reservation.status} شده است.`,
          409,
          { reservationStatus: reservation.status }
        );
      }

      const amount = decimal(String(reservation.amount), 'amountNoa', {
        allowZero: false
      });
      const availableBefore = decimal(
        String(wallet.available_balance),
        'availableBalance'
      );
      const reservedBefore = decimal(
        String(wallet.reserved_balance),
        'reservedBalance'
      );
      if (reservedBefore.units < amount.units) {
        throw noaError(
          'NOA_LEDGER_INVARIANT_VIOLATION',
          'ماندهٔ رزروشده با دفتر تراکنش سازگار نیست.',
          500
        );
      }

      const walletUpdated = targetStatus === 'captured'
        ? await repository.captureWallet(wallet.wallet_id, amount.value, connection)
        : await repository.releaseWallet(wallet.wallet_id, amount.value, connection);
      if (!walletUpdated) {
        throw noaError(
          'NOA_LEDGER_INVARIANT_VIOLATION',
          'به‌روزرسانی اتمیک کیف پول انجام نشد.',
          500
        );
      }

      const transitioned = await repository.transitionReservation(
        reservationId,
        'reserved',
        targetStatus,
        releaseReason,
        connection
      );
      if (!transitioned) {
        throw noaError('NOA_RESERVATION_RACE', 'وضعیت رزرو همزمان تغییر کرده است.', 409);
      }

      const availableAfterUnits = targetStatus === 'released'
        ? availableBefore.units + amount.units
        : availableBefore.units;
      const reservedAfterUnits = reservedBefore.units - amount.units;
      await repository.insertLog({
        transactionId: randomUUID(),
        walletId: wallet.wallet_id,
        reservationId,
        entryType: targetStatus === 'captured' ? 'capture' : 'release',
        amount: amount.value,
        availableDelta: targetStatus === 'released' ? amount.value : formatFixed(0n, NOA_SCALE),
        reservedDelta: formatFixed(-amount.units, NOA_SCALE),
        availableBefore: availableBefore.value,
        availableAfter: formatFixed(availableAfterUnits, NOA_SCALE),
        reservedBefore: reservedBefore.value,
        reservedAfter: formatFixed(reservedAfterUnits, NOA_SCALE),
        actionKey: reservation.action_key,
        referenceType: reservation.reference_type,
        referenceId: reservation.reference_id,
        idempotencyHash: reservation.idempotency_key_hash,
        payloadHash: reservation.payload_hash,
        actorType,
        actorId,
        metadata
      }, connection);

      return reservationDto({
        ...reservation,
        status: targetStatus,
        captured_at: targetStatus === 'captured' ? new Date() : null,
        released_at: targetStatus === 'released' ? new Date() : null,
        release_reason: releaseReason
      }, { replayed: false, changed: true });
    });
  }

  const capture = (reservationOrInput, options = {}) =>
    transitionReservation(reservationOrInput, options, 'captured');

  const release = (reservationOrInput, options = {}) =>
    transitionReservation(reservationOrInput, options, 'released');

  async function getBalance(userIdInput, options = {}) {
    const userId = requireText(
      typeof userIdInput === 'object' ? userIdInput?.userId : userIdInput,
      'userId'
    );
    const connection = options.connection || (
      typeof userIdInput === 'object' ? userIdInput.connection : null
    );
    return repository.inTransaction(connection, async (transaction) => {
      await repository.ensureWallet(userId, transaction);
      const wallet = await repository.getWalletByUser(userId, {
        connection: transaction,
        forUpdate: false
      });
      if (!wallet) throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول پیدا نشد.', 500);
      return walletDto(wallet);
    });
  }

  async function getConfig(options = {}) {
    const [rows, rateRow] = await Promise.all([
      repository.listPricing({ connection: options.connection }),
      repository.getSetting(NOA_SETTING_KEYS.TOMAN_PER_NOA, {
        connection: options.connection
      })
    ]);
    const pricingConfigs = rows.map(pricingDto);
    if (
      !rateRow ||
      !booleanFromDb(rateRow.is_active) ||
      String(rateRow.fiat_currency).toUpperCase() !== NOA_FIAT_CURRENCY
    ) {
      throw noaError(
        'NOA_EXCHANGE_RATE_UNAVAILABLE',
        'نرخ تبدیل تومان به Noa در پایگاه داده فعال نیست.',
        503
      );
    }
    const tomanPerNoa = decimal(String(rateRow.decimal_value), 'tomanPerNoa', {
      allowZero: false
    }).value;
    const prices = Object.fromEntries(
      pricingConfigs.map((item) => [item.actionKey, item.unitPriceNoa])
    );
    return {
      currency: NOA_CURRENCY,
      fiatCurrency: NOA_FIAT_CURRENCY,
      tomanPerNoa,
      exchangeRate: {
        settingKey: NOA_SETTING_KEYS.TOMAN_PER_NOA,
        tomanPerNoa,
        fiatCurrency: NOA_FIAT_CURRENCY,
        version: Number(rateRow.version),
        updatedByAdminId: rateRow.updated_by_admin_id || null,
        updatedAt: rateRow.updated_at || null
      },
      pricingConfigs,
      prices,
      topUpMethods: {
        manualBankTransfer: { enabled: true },
        paymentGateway: { enabled: PAYMENT_GATEWAY_ENABLED }
      },
      paymentGatewayEnabled: PAYMENT_GATEWAY_ENABLED
    };
  }

  async function updatePricing(input) {
    const actionKey = normalizeActionKey(input?.actionKey);
    const unitPrice = decimal(input?.unitPriceNoa, 'unitPriceNoa', {
      allowZero: false
    });
    const adminId = requireText(input?.adminId, 'adminId');
    const expectedVersion = parseExpectedVersion(input?.expectedVersion);
    return repository.inTransaction(input?.connection, async (connection) => {
      const current = await repository.getPricing(actionKey, {
        connection,
        forUpdate: true
      });
      if (!current) {
        throw noaError('NOA_PRICING_NOT_FOUND', 'تنظیم قیمت پیدا نشد.', 404);
      }
      if (expectedVersion !== null && Number(current.version) !== expectedVersion) {
        throw noaError(
          'NOA_VERSION_CONFLICT',
          'قیمت توسط مدیر دیگری تغییر کرده است؛ صفحه را تازه کنید.',
          409,
          { currentVersion: Number(current.version) }
        );
      }
      const isActive = input.isActive === undefined
        ? booleanFromDb(current.is_active)
        : Boolean(input.isActive);
      const updated = await repository.updatePricing({
        actionKey,
        unitPrice: unitPrice.value,
        adminId,
        currentVersion: Number(current.version),
        isActive
      }, connection);
      if (!updated) throw noaError('NOA_VERSION_CONFLICT', 'قیمت همزمان تغییر کرده است.', 409);
      return pricingDto({
        ...current,
        unit_price: unitPrice.value,
        is_active: isActive ? 1 : 0,
        version: Number(current.version) + 1,
        updated_by_admin_id: adminId,
        updated_at: new Date()
      });
    });
  }

  async function updateTomanRate(input) {
    const rate = decimal(input?.tomanPerNoa, 'tomanPerNoa', { allowZero: false });
    const adminId = requireText(input?.adminId, 'adminId');
    const expectedVersion = parseExpectedVersion(input?.expectedVersion);
    return repository.inTransaction(input?.connection, async (connection) => {
      const current = await repository.getSetting(NOA_SETTING_KEYS.TOMAN_PER_NOA, {
        connection,
        forUpdate: true
      });
      if (!current || !booleanFromDb(current.is_active)) {
        throw noaError('NOA_EXCHANGE_RATE_UNAVAILABLE', 'نرخ تبدیل فعال پیدا نشد.', 503);
      }
      if (expectedVersion !== null && Number(current.version) !== expectedVersion) {
        throw noaError(
          'NOA_VERSION_CONFLICT',
          'نرخ تبدیل توسط مدیر دیگری تغییر کرده است؛ صفحه را تازه کنید.',
          409,
          { currentVersion: Number(current.version) }
        );
      }
      const updated = await repository.updateSetting({
        settingKey: NOA_SETTING_KEYS.TOMAN_PER_NOA,
        decimalValue: rate.value,
        adminId,
        currentVersion: Number(current.version)
      }, connection);
      if (!updated) throw noaError('NOA_VERSION_CONFLICT', 'نرخ تبدیل همزمان تغییر کرده است.', 409);
      return {
        settingKey: NOA_SETTING_KEYS.TOMAN_PER_NOA,
        tomanPerNoa: rate.value,
        fiatCurrency: NOA_FIAT_CURRENCY,
        version: Number(current.version) + 1,
        updatedByAdminId: adminId,
        updatedAt: new Date()
      };
    });
  }

  async function credit(input, options = {}) {
    const userId = requireText(input?.userId, 'userId');
    const amount = decimal(input?.amountNoa, 'amountNoa', { allowZero: false });
    const entryType = requireText(input?.entryType || 'credit', 'entryType', 32);
    const referenceType = requireText(input?.referenceType, 'referenceType', 64);
    const referenceId = requireText(input?.referenceId, 'referenceId');
    const idempotencyHash = hashIdempotencyKey(input?.idempotencyKey);
    const payloadHash = digestValue(input?.payloadHash, 'payloadHash');
    const actorType = normalizeActor(input?.actorType, 'system');
    const actorId = input?.actorId
      ? requireText(String(input.actorId), 'actorId')
      : null;
    const metadata = normalizeMetadata(input?.metadata);

    return repository.inTransaction(options.connection || input?.connection, async (connection) => {
      await repository.ensureWallet(userId, connection);
      const wallet = await repository.getWalletByUser(userId, {
        connection,
        forUpdate: true
      });
      if (!wallet) throw noaError('NOA_WALLET_UNAVAILABLE', 'کیف پول پیدا نشد.', 500);
      const existing = await repository.findLogByIdempotency(
        wallet.wallet_id,
        idempotencyHash,
        entryType,
        connection
      );
      if (existing) {
        if (
          !safeEqual(existing.payload_hash, payloadHash) ||
          String(existing.reference_type) !== referenceType ||
          String(existing.reference_id) !== referenceId ||
          decimal(String(existing.amount), 'amountNoa').units !== amount.units
        ) {
          throw noaError(
            'NOA_IDEMPOTENCY_CONFLICT',
            'کلید تکرار با واریز دیگری استفاده شده است.',
            409
          );
        }
        return {
          transactionId: String(existing.transaction_id),
          amountNoa: amount.value,
          replayed: true,
          changed: false,
          wallet: walletDto(wallet)
        };
      }

      const availableBefore = decimal(
        String(wallet.available_balance),
        'availableBalance'
      );
      const reservedBefore = decimal(
        String(wallet.reserved_balance),
        'reservedBalance'
      );
      const didCredit = await repository.creditWallet(
        wallet.wallet_id,
        amount.value,
        connection
      );
      if (!didCredit) {
        throw noaError('NOA_WALLET_UPDATE_FAILED', 'واریز به کیف پول انجام نشد.', 500);
      }
      const transactionId = randomUUID();
      const availableAfter = formatFixed(
        availableBefore.units + amount.units,
        NOA_SCALE
      );
      await repository.insertLog({
        transactionId,
        walletId: wallet.wallet_id,
        reservationId: null,
        entryType,
        amount: amount.value,
        availableDelta: amount.value,
        reservedDelta: formatFixed(0n, NOA_SCALE),
        availableBefore: availableBefore.value,
        availableAfter,
        reservedBefore: reservedBefore.value,
        reservedAfter: reservedBefore.value,
        actionKey: null,
        referenceType,
        referenceId,
        idempotencyHash,
        payloadHash,
        actorType,
        actorId,
        metadata
      }, connection);
      return {
        transactionId,
        amountNoa: amount.value,
        replayed: false,
        changed: true,
        wallet: walletDto({
          ...wallet,
          available_balance: availableAfter,
          version: Number(wallet.version) + 1,
          updated_at: new Date()
        })
      };
    });
  }

  async function listTransactions(userIdInput, options = {}) {
    const userId = requireText(userIdInput, 'userId');
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const rows = await repository.listTransactions(userId, {
      connection: options.connection,
      limit,
      before: options.before
    });
    return rows.map((row) => ({
      transactionId: String(row.transaction_id),
      reservationId: row.reservation_id || null,
      type: String(row.entry_type),
      amountNoa: decimal(String(row.amount), 'amountNoa', { allowZero: false }).value,
      availableDeltaNoa: decimal(String(row.available_delta), 'availableDelta', {
        allowNegative: true
      }).value,
      reservedDeltaNoa: decimal(String(row.reserved_delta), 'reservedDelta', {
        allowNegative: true
      }).value,
      actionKey: row.action_key || null,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      actorType: row.actor_type,
      metadata: row.metadata || null,
      createdAt: row.created_at
    }));
  }

  async function releaseExpiredReservations(options = {}) {
    const reservationIds = await repository.listExpiredReservationIds({
      limit: options.limit
    });
    const result = { scanned: reservationIds.length, released: 0, skipped: 0 };
    for (const reservationId of reservationIds) {
      try {
        const released = await release(reservationId, {
          reason: 'reservation_expired',
          actorType: 'system',
          actorId: options.actorId || 'noa-expiry-sweeper',
          metadata: { source: 'expiry_sweeper' }
        });
        if (released.status === 'released') result.released += 1;
        else result.skipped += 1;
      } catch (error) {
        if (
          error?.code === 'NOA_RESERVATION_FINALIZED' ||
          error?.code === 'NOA_RESERVATION_NOT_FOUND' ||
          error?.code === 'NOA_RESERVATION_RACE'
        ) {
          result.skipped += 1;
          continue;
        }
        throw error;
      }
    }
    return result;
  }

  return {
    capture,
    credit,
    getBalance,
    getConfig,
    listTransactions,
    quote,
    release,
    releaseExpiredReservations,
    reserve,
    updatePricing,
    updateTomanRate
  };
}

module.exports = {
  createNoaBillingService,
  normalizeQuantity,
  pricingDto,
  reservationDto,
  walletDto
};
