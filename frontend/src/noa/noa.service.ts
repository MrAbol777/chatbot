import type {
  AdminIdentity,
  AdminNoaUserWallet,
  AdminNoaWalletAdjustment,
  AdminNoaUser,
  NoaBankTransferAccount,
  NoaExchangeRate,
  NoaPricingConfig,
  NoaPublicConfig,
  NoaReceipt,
  NoaReceiptStatus,
  NoaWallet
} from './noa.types';

type JsonRecord = Record<string, unknown>;

export class NoaApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'NoaApiError';
    this.status = status;
    this.code = code;
  }
}

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

const pick = (source: JsonRecord, ...keys: string[]): unknown => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;

const asNullableString = (value: unknown): string | null => {
  const text = asString(value).trim();
  return text || null;
};

const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
};

const normalizeStatus = (value: unknown): NoaReceiptStatus => {
  const status = asString(value).toLowerCase();
  if (status === 'approved' || status === 'rejected') return status;
  return 'pending';
};

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

async function assertOk(response: Response, fallbackMessage: string): Promise<unknown> {
  const payload = await readJson(response);
  if (response.ok) return payload;
  const source = asRecord(payload);
  const nestedError = asRecord(source.error);
  const message =
    asNullableString(pick(source, 'message', 'error_description')) ||
    asNullableString(pick(nestedError, 'message')) ||
    (typeof source.error === 'string' ? source.error : null) ||
    fallbackMessage;
  const code =
    asNullableString(pick(source, 'code')) ||
    asNullableString(pick(nestedError, 'code')) ||
    (typeof source.error === 'string' && /^[A-Z0-9_]+$/.test(source.error) ? source.error : null);
  throw new NoaApiError(message, response.status, code);
}

function authHeaders(): HeadersInit {
  try {
    const token = localStorage.getItem('chat_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function normalizeExchangeRate(payload: unknown): NoaExchangeRate {
  const root = asRecord(payload);
  const source = asRecord(pick(root, 'exchangeRate', 'exchange_rate') || root);
  const tomanPerNoa = asString(pick(source, 'tomanPerNoa', 'toman_per_noa', 'rate', 'unitPrice', 'unit_price')).trim();
  if (!tomanPerNoa) throw new NoaApiError('نرخ تبدیل نوآ از سرور دریافت نشد.', 503, 'NOA_EXCHANGE_RATE_UNAVAILABLE');
  return {
    fiatCurrency: 'TOMAN',
    tomanPerNoa,
    version: asString(pick(source, 'version'), '0'),
    isActive: pick(source, 'isActive', 'is_active') === undefined
      ? undefined
      : asBoolean(pick(source, 'isActive', 'is_active')),
    updatedAt: asNullableString(pick(source, 'updatedAt', 'updated_at'))
  };
}

function normalizeBankTransferAccount(payload: unknown): NoaBankTransferAccount | null {
  const source = asRecord(payload);
  const cardNumber = asString(pick(source, 'cardNumber', 'card_number')).replace(/\D/g, '');
  const cardHolderName = asNullableString(pick(source, 'cardHolderName', 'card_holder_name'));
  if (!/^\d{16}$/.test(cardNumber) || !cardHolderName) return null;
  return {
    cardNumber,
    cardHolderName,
    version: asString(pick(source, 'version'), '0'),
    updatedByAdminId: asNullableString(pick(source, 'updatedByAdminId', 'updated_by_admin_id')),
    updatedAt: asNullableString(pick(source, 'updatedAt', 'updated_at'))
  };
}

export function normalizeWallet(payload: unknown): NoaWallet {
  const root = asRecord(payload);
  const source = asRecord(pick(root, 'wallet', 'data') || root);
  const availableBalance = asString(pick(
    source,
    'availableBalance',
    'available_balance',
    'availableBalanceNoa',
    'availableNoa',
    'balanceNoa',
    'balance'
  )).trim();
  const reservedBalance = asString(pick(
    source,
    'reservedBalance',
    'reserved_balance',
    'reservedBalanceNoa',
    'reservedNoa'
  ), '0').trim();
  if (!availableBalance) throw new NoaApiError('موجودی کیف پول از سرور دریافت نشد.', 502, 'NOA_INVALID_WALLET_RESPONSE');
  return {
    currency: 'NOA',
    availableBalance,
    reservedBalance,
    totalBalance: asString(pick(source, 'totalBalance', 'total_balance', 'totalNoa'), availableBalance),
    updatedAt: asNullableString(pick(source, 'updatedAt', 'updated_at')),
    exchangeRate: normalizeExchangeRate(pick(source, 'exchangeRate', 'exchange_rate') || pick(root, 'exchangeRate', 'exchange_rate')),
    bankTransferAccount: normalizeBankTransferAccount(
      pick(source, 'bankTransferAccount', 'bank_transfer_account') || pick(root, 'bankTransferAccount', 'bank_transfer_account')
    )
  };
}

export function normalizeReceipt(payload: unknown): NoaReceipt {
  const source = asRecord(payload);
  const userSource = asRecord(pick(source, 'user'));
  const userId = asNullableString(pick(source, 'userId', 'user_id') || pick(userSource, 'userId', 'user_id', 'id'));
  const receiptId = asString(pick(source, 'receiptId', 'receipt_id', 'id')).trim();
  return {
    receiptId,
    userId: userId || undefined,
    declaredToman: asNullableString(pick(source, 'declaredToman', 'declared_toman')),
    verifiedToman: asNullableString(pick(source, 'verifiedToman', 'verified_toman', 'verifiedFiatAmount', 'verified_fiat_amount')),
    calculatedNoa: asNullableString(pick(source, 'calculatedNoa', 'calculated_noa', 'requestedNoa', 'requested_noa')),
    approvedNoa: asNullableString(pick(source, 'approvedNoa', 'approved_noa')),
    exchangeRateSnapshot: asNullableString(pick(source, 'exchangeRateSnapshot', 'exchange_rate_snapshot')),
    status: normalizeStatus(pick(source, 'status')),
    mimeType: asNullableString(pick(source, 'mimeType', 'mime_type')),
    sizeBytes: Number.isFinite(Number(pick(source, 'sizeBytes', 'size_bytes')))
      ? Number(pick(source, 'sizeBytes', 'size_bytes'))
      : null,
    submittedAt: asNullableString(pick(source, 'submittedAt', 'submitted_at', 'createdAt', 'created_at')),
    reviewedAt: asNullableString(pick(source, 'reviewedAt', 'reviewed_at')),
    reviewReason: asNullableString(pick(source, 'reviewReason', 'review_reason', 'reason')),
    manualOverride: asBoolean(pick(source, 'manualOverride', 'manual_override')),
    overrideReason: asNullableString(pick(source, 'overrideReason', 'override_reason')),
    imageUrl: asNullableString(pick(source, 'imageUrl', 'image_url')),
    user: userId
      ? {
          userId,
          name: asNullableString(pick(userSource, 'name')),
          phone: asNullableString(pick(userSource, 'phone'))
        }
      : undefined
  };
}

export function normalizePricingConfig(payload: unknown): NoaPricingConfig {
  const source = asRecord(payload);
  return {
    actionKey: asString(pick(source, 'actionKey', 'action_key')).trim(),
    unit: asString(pick(source, 'unit')).trim(),
    unitPrice: asString(pick(source, 'unitPrice', 'unit_price', 'unitPriceNoa')).trim(),
    isActive: asBoolean(pick(source, 'isActive', 'is_active'), true),
    version: asString(pick(source, 'version'), '0'),
    updatedAt: asNullableString(pick(source, 'updatedAt', 'updated_at')),
    updatedByAdminId: asNullableString(pick(source, 'updatedByAdminId', 'updated_by_admin_id'))
  };
}

export function createIdempotencyKey(scope: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${scope}:${random}`;
}

export async function fetchNoaWallet(): Promise<NoaWallet> {
  let response = await fetch('/api/noa/wallet', {
    credentials: 'include',
    headers: authHeaders()
  });
  if (response.status === 404) {
    response = await fetch('/api/noa/balance', {
      credentials: 'include',
      headers: authHeaders()
    });
  }
  return normalizeWallet(await assertOk(response, 'دریافت موجودی نوآ انجام نشد.'));
}

export async function fetchNoaPublicConfig(): Promise<NoaPublicConfig> {
  const response = await fetch('/api/noa/config', {
    credentials: 'include',
    cache: 'no-store'
  });
  const payload = asRecord(await assertOk(response, 'دریافت قیمت‌های نوآ انجام نشد.'));
  const pricing = pick(payload, 'pricingConfigs', 'pricing');
  return {
    exchangeRate: normalizeExchangeRate(payload),
    pricingConfigs: Array.isArray(pricing) ? pricing.map(normalizePricingConfig) : [],
    bankTransferAccount: normalizeBankTransferAccount(pick(payload, 'bankTransferAccount', 'bank_transfer_account')),
    paymentGatewayEnabled: false
  };
}

export async function listNoaReceipts(): Promise<NoaReceipt[]> {
  const response = await fetch('/api/noa/receipts', {
    credentials: 'include',
    headers: authHeaders()
  });
  const payload = await assertOk(response, 'دریافت رسیدها انجام نشد.');
  const source = asRecord(payload);
  const items = pick(source, 'items', 'receipts');
  return Array.isArray(items) ? items.map(normalizeReceipt) : [];
}

export async function submitNoaReceipt(input: {
  receipt: File;
  idempotencyKey: string;
}): Promise<NoaReceipt> {
  const body = new FormData();
  body.set('receipt', input.receipt);

  const response = await fetch('/api/noa/receipts', {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...authHeaders(),
      'Idempotency-Key': input.idempotencyKey
    },
    body
  });
  const payload = await assertOk(response, 'ثبت رسید انجام نشد.');
  const source = asRecord(payload);
  return normalizeReceipt(pick(source, 'receipt', 'item', 'data') || source);
}

export async function fetchAdminIdentity(): Promise<AdminIdentity> {
  const response = await fetch('/api/admin/me', { credentials: 'include' });
  const payload = asRecord(await assertOk(response, 'دریافت سطح دسترسی مدیر انجام نشد.'));
  const source = asRecord(pick(payload, 'admin') || payload);
  return {
    id: asNullableString(pick(source, 'id')) || undefined,
    username: asNullableString(pick(source, 'username')) || undefined,
    role: asString(pick(source, 'role')).toLowerCase()
  };
}

export async function searchAdminNoaUsers(query: string): Promise<AdminNoaUser[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];
  const params = new URLSearchParams({ q: normalizedQuery, page: '1', pageSize: '6' });
  const response = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' });
  const payload = asRecord(await assertOk(response, 'جست‌وجوی کاربر انجام نشد.'));
  const items = pick(payload, 'items', 'users');
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const source = asRecord(item);
    return {
      userId: asString(pick(source, 'userId', 'user_id', 'id')).trim(),
      name: asString(pick(source, 'name'), 'کاربر').trim() || 'کاربر',
      phone: asNullableString(pick(source, 'phone'))
    };
  }).filter((item) => Boolean(item.userId));
}

function normalizeAdminWallet(payload: unknown): AdminNoaUserWallet['wallet'] {
  const wallet = asRecord(payload);
  const availableBalance = asString(pick(wallet, 'availableBalance', 'availableNoa', 'availableBalanceNoa')).trim();
  if (!availableBalance) throw new NoaApiError('موجودی کیف پول از سرور دریافت نشد.', 502, 'NOA_INVALID_WALLET_RESPONSE');
  return {
    availableBalance,
    reservedBalance: asString(pick(wallet, 'reservedBalance', 'reservedNoa'), '0').trim(),
    totalBalance: asString(pick(wallet, 'totalBalance', 'totalNoa'), availableBalance).trim(),
    updatedAt: asNullableString(pick(wallet, 'updatedAt', 'updated_at'))
  };
}

export async function fetchAdminNoaUserWallet(userId: string): Promise<AdminNoaUserWallet> {
  const response = await fetch(`/api/admin/noa/users/${encodeURIComponent(userId)}/wallet`, { credentials: 'include' });
  const payload = asRecord(await assertOk(response, 'دریافت موجودی کاربر انجام نشد.'));
  const user = asRecord(pick(payload, 'user'));
  return {
    user: {
      userId: asString(pick(user, 'userId', 'user_id', 'id')).trim(),
      name: asString(pick(user, 'name'), 'کاربر').trim() || 'کاربر',
      phone: asNullableString(pick(user, 'phone'))
    },
    wallet: normalizeAdminWallet(pick(payload, 'wallet') || payload)
  };
}

export async function adjustAdminNoaWallet(input: {
  userId: string;
  amountNoa: string;
  direction: 'increase' | 'decrease';
  note?: string;
  idempotencyKey: string;
}): Promise<AdminNoaWalletAdjustment> {
  const response = await fetch('/api/admin/noa/wallet-adjustments', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey
    },
    body: JSON.stringify({
      userId: input.userId,
      amountNoa: input.amountNoa,
      direction: input.direction,
      note: input.note || ''
    })
  });
  const payload = asRecord(await assertOk(response, 'شارژ دستی نوآ انجام نشد.'));
  const source = asRecord(pick(payload, 'credit', 'data') || payload);
  return {
    transactionId: asString(pick(source, 'transactionId', 'transaction_id')).trim(),
    amountNoa: asString(pick(source, 'amountNoa', 'amount_noa')).trim(),
    replayed: asBoolean(pick(source, 'replayed')),
    deltaNoa: asString(pick(source, 'deltaNoa', 'delta_noa')).trim(),
    wallet: normalizeAdminWallet(pick(source, 'wallet') || source)
  };
}

export async function fetchPendingNoaNotifications(): Promise<Array<{ notificationId: string; message: string }>> {
  const response = await fetch('/api/noa/notifications/pending?limit=3', {
    credentials: 'include',
    headers: authHeaders()
  });
  const payload = asRecord(await assertOk(response, 'دریافت اعلان‌های نوآ انجام نشد.'));
  const items = pick(payload, 'items');
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const source = asRecord(item);
    return {
      notificationId: asString(pick(source, 'notificationId', 'notification_id')).trim(),
      message: asString(pick(source, 'message')).trim()
    };
  }).filter((item) => item.notificationId && item.message);
}

export async function fetchAdminNoaPricing(): Promise<NoaPricingConfig[]> {
  const response = await fetch('/api/admin/noa/pricing', { credentials: 'include' });
  const payload = asRecord(await assertOk(response, 'دریافت قیمت‌های نوآ انجام نشد.'));
  const items = pick(payload, 'items', 'pricing');
  return Array.isArray(items) ? items.map(normalizePricingConfig) : [];
}

export async function updateAdminNoaPricing(
  actionKey: string,
  input: { unitPrice: string; isActive: boolean; expectedVersion: string }
): Promise<NoaPricingConfig> {
  const response = await fetch(`/api/admin/noa/pricing/${encodeURIComponent(actionKey)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const payload = asRecord(await assertOk(response, 'ذخیره قیمت نوآ انجام نشد.'));
  return normalizePricingConfig(pick(payload, 'item', 'pricing', 'data') || payload);
}

export async function fetchAdminNoaConfig(): Promise<NoaExchangeRate> {
  const response = await fetch('/api/admin/noa/config', { credentials: 'include' });
  return normalizeExchangeRate(await assertOk(response, 'دریافت نرخ تبدیل نوآ انجام نشد.'));
}

export async function updateAdminNoaConfig(input: {
  tomanPerNoa: string;
  expectedVersion: string;
}): Promise<NoaExchangeRate> {
  const response = await fetch('/api/admin/noa/config', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const payload = asRecord(await assertOk(response, 'ذخیره نرخ تبدیل نوآ انجام نشد.'));
  return normalizeExchangeRate(pick(payload, 'config', 'data') || payload);
}

export async function fetchAdminNoaBankTransferAccount(): Promise<NoaBankTransferAccount | null> {
  const response = await fetch('/api/admin/noa/bank-account', { credentials: 'include' });
  const payload = asRecord(await assertOk(response, 'دریافت حساب واریز بانکی انجام نشد.'));
  return normalizeBankTransferAccount(pick(payload, 'bankTransferAccount', 'bank_transfer_account', 'data'));
}

export async function updateAdminNoaBankTransferAccount(input: {
  cardNumber: string;
  cardHolderName: string;
  expectedVersion: string | null;
}): Promise<NoaBankTransferAccount> {
  const response = await fetch('/api/admin/noa/bank-account', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const payload = asRecord(await assertOk(response, 'ذخیره حساب واریز بانکی انجام نشد.'));
  const account = normalizeBankTransferAccount(pick(payload, 'bankTransferAccount', 'bank_transfer_account', 'data') || payload);
  if (!account) throw new NoaApiError('حساب واریز معتبر از سرور دریافت نشد.', 502, 'NOA_INVALID_BANK_ACCOUNT_RESPONSE');
  return account;
}

export async function listAdminNoaReceipts(status: NoaReceiptStatus | 'all'): Promise<NoaReceipt[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (status !== 'all') params.set('status', status);
  const response = await fetch(`/api/admin/noa/receipts?${params.toString()}`, { credentials: 'include' });
  const payload = asRecord(await assertOk(response, 'دریافت رسیدهای بانکی انجام نشد.'));
  const items = pick(payload, 'items', 'receipts');
  return Array.isArray(items) ? items.map(normalizeReceipt) : [];
}

export async function approveAdminNoaReceipt(
  receiptId: string,
  input: {
    verifiedToman: string;
    approvedNoa?: string;
    reason?: string;
    overrideReason?: string;
  }
): Promise<NoaReceipt> {
  const response = await fetch(`/api/admin/noa/receipts/${encodeURIComponent(receiptId)}/approve`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': createIdempotencyKey(`receipt-approve-${receiptId}`)
    },
    body: JSON.stringify(input)
  });
  const payload = asRecord(await assertOk(response, 'تأیید رسید انجام نشد.'));
  return normalizeReceipt(pick(payload, 'receipt', 'item', 'data') || payload);
}

export async function rejectAdminNoaReceipt(receiptId: string, reason: string): Promise<NoaReceipt> {
  const response = await fetch(`/api/admin/noa/receipts/${encodeURIComponent(receiptId)}/reject`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': createIdempotencyKey(`receipt-reject-${receiptId}`)
    },
    body: JSON.stringify({ reason })
  });
  const payload = asRecord(await assertOk(response, 'رد رسید انجام نشد.'));
  return normalizeReceipt(pick(payload, 'receipt', 'item', 'data') || payload);
}
