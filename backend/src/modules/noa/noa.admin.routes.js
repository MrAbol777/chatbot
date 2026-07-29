'use strict';

const express = require('express');
const { FINANCIAL_ADMIN_ROLES } = require('./noa.constants');
const { noaError, sendNoaError } = require('./noa.errors');
const { decimalInput } = require('./noa.routes');
const { receiptDto } = require('./noa-receipt.service');
const { hashIdempotencyKey } = require('./noa.crypto');

function walletAdjustmentInput(req) {
  const userId = String(req.body?.userId || '').trim();
  const amountNoa = decimalInput(req.body?.amountNoa ?? req.body?.amount);
  const direction = String(req.body?.direction || '').trim().toLowerCase();
  const note = String(req.body?.note || '').trim();
  const idempotencyKey = String(req.get?.('Idempotency-Key') || '').trim();

  if (!userId || userId.length > 191) {
    throw noaError('NOA_MANUAL_CREDIT_USER_REQUIRED', 'کاربر مقصد را انتخاب کنید.', 400);
  }
  if (direction !== 'increase' && direction !== 'decrease') {
    throw noaError('NOA_INVALID_ADJUSTMENT_DIRECTION', 'نوع تغییر موجودی معتبر نیست.', 400);
  }
  if (note.length > 500) {
    throw noaError('NOA_ADMIN_NOTE_TOO_LONG', 'یادداشت حداکثر ۵۰۰ نویسه است.', 400);
  }

  // The reference is stable but does not expose a client-controlled key in the ledger.
  const referenceId = `manual-credit:${hashIdempotencyKey(idempotencyKey).toString('hex')}`;
  return {
    userId,
    amountNoa,
    direction,
    note,
    idempotencyKey,
    referenceId
  };
}

function requireFinancialAdmin(req, res, next) {
  const role = String(req.admin?.role || '').trim().toLowerCase();
  if (!FINANCIAL_ADMIN_ROLES.has(role)) {
    return res.status(403).json({
      success: false,
      error: 'NOA_FINANCE_ROLE_REQUIRED',
      message: 'این عملیات فقط برای نقش مالی یا مدیر ارشد مجاز است.'
    });
  }
  req.admin.role = role;
  return next();
}

function adminIdentity(req) {
  return String(
    req.admin?.id ||
    req.admin?.adminId ||
    req.admin?.username ||
    ''
  ).trim();
}

function createNoaAdminRouter({
  billingService,
  receiptService,
  receiptStorage,
  usersRepository,
  requireAdminAuth,
  appendAudit = async () => {},
  logger = console
}) {
  if (typeof requireAdminAuth !== 'function') {
    throw new TypeError('Noa admin router requires requireAdminAuth');
  }
  const router = express.Router();
  router.use(requireAdminAuth);
  router.use(requireFinancialAdmin);

  async function audit(req, action, target, details) {
    try {
      await appendAudit({
        adminUsername: req.admin?.username || adminIdentity(req),
        action,
        target,
        details: { ...details, adminRole: req.admin.role }
      });
    } catch (error) {
      logger?.error?.('[NOA] Failed to append secondary admin audit', error);
    }
  }

  router.get('/config', async (_req, res) => {
    try {
      return res.json(await billingService.getConfig());
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/pricing', async (_req, res) => {
    try {
      const config = await billingService.getConfig();
      return res.json({ items: config.pricingConfigs });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  async function updatePricing(req, res) {
    try {
      const result = await billingService.updatePricing({
        actionKey: req.params.actionKey,
        unitPriceNoa: decimalInput(
          req.body?.unitPriceNoa ?? req.body?.unitPrice ?? req.body?.price
        ),
        isActive: req.body?.isActive,
        expectedVersion: req.body?.expectedVersion ?? req.body?.version,
        adminId: adminIdentity(req)
      });
      await audit(req, 'noa_pricing_updated', result.actionKey, {
        unitPriceNoa: result.unitPriceNoa,
        isActive: result.isActive,
        version: result.version
      });
      return res.json(result);
    } catch (error) {
      return sendNoaError(res, error);
    }
  }
  router.put('/pricing/:actionKey', updatePricing);
  router.patch('/pricing/:actionKey', updatePricing);

  async function updateRate(req, res) {
    try {
      const result = await billingService.updateTomanRate({
        tomanPerNoa: decimalInput(
          req.body?.tomanPerNoa ?? req.body?.decimalValue ?? req.body?.value
        ),
        expectedVersion: req.body?.expectedVersion ?? req.body?.version,
        adminId: adminIdentity(req)
      });
      await audit(req, 'noa_toman_rate_updated', 'toman_per_noa', {
        tomanPerNoa: result.tomanPerNoa,
        version: result.version
      });
      return res.json(result);
    } catch (error) {
      return sendNoaError(res, error);
    }
  }
  router.put('/exchange-rate', updateRate);
  router.patch('/exchange-rate', updateRate);
  router.put('/config', updateRate);
  router.patch('/config', updateRate);
  router.put('/settings/toman-per-noa', updateRate);
  router.patch('/settings/toman-per-noa', updateRate);

  router.get('/bank-account', async (_req, res) => {
    try {
      const config = await billingService.getConfig();
      return res.json({ bankTransferAccount: config.bankTransferAccount });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  async function updateBankTransferAccount(req, res) {
    try {
      const result = await billingService.updateBankTransferAccount({
        cardNumber: req.body?.cardNumber ?? req.body?.card_number,
        cardHolderName: req.body?.cardHolderName ?? req.body?.card_holder_name,
        expectedVersion: req.body?.expectedVersion ?? req.body?.version,
        adminId: adminIdentity(req)
      });
      await audit(req, 'noa_bank_transfer_account_updated', 'manual_bank_transfer', {
        cardNumberLastFour: result.cardNumber.slice(-4),
        cardHolderName: result.cardHolderName,
        version: result.version
      });
      return res.json({ bankTransferAccount: result });
    } catch (error) {
      return sendNoaError(res, error);
    }
  }
  router.put('/bank-account', updateBankTransferAccount);
  router.patch('/bank-account', updateBankTransferAccount);

  router.get('/users/:userId/wallet', async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const user = await usersRepository?.findUserById?.(userId);
      if (!user) throw noaError('NOA_MANUAL_CREDIT_USER_NOT_FOUND', 'کاربر مقصد پیدا نشد.', 404);
      const wallet = await billingService.getBalance(userId);
      return res.json({
        user: { userId, name: user.name || 'کاربر', phone: user.phone || null },
        wallet
      });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.post('/wallet-adjustments', async (req, res) => {
    try {
      const input = walletAdjustmentInput(req);
      if (usersRepository?.findUserById) {
        const user = await usersRepository.findUserById(input.userId);
        if (!user) throw noaError('NOA_MANUAL_CREDIT_USER_NOT_FOUND', 'کاربر مقصد پیدا نشد.', 404);
      }
      const signedAmount = input.direction === 'decrease' ? `-${input.amountNoa}` : input.amountNoa;
      const result = await billingService.adjustByAdmin({
        userId: input.userId,
        deltaNoa: signedAmount,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: {
          userId: input.userId,
          amountNoa: input.amountNoa,
          direction: input.direction,
          note: input.note
        },
        actorId: adminIdentity(req),
        note: input.note
      });
      await audit(req, 'noa_user_wallet_adjusted', input.userId, {
        direction: input.direction,
        amountNoa: result.amountNoa,
        note: input.note || null,
        transactionId: result.transactionId,
        replayed: result.replayed
      });
      return res.status(result.replayed ? 200 : 201).json({
        transactionId: result.transactionId,
        deltaNoa: result.deltaNoa,
        amountNoa: result.amountNoa,
        replayed: result.replayed,
        wallet: result.wallet
      });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/receipts', async (req, res) => {
    try {
      return res.json(await receiptService.listForAdmin({
        status: req.query?.status,
        page: req.query?.page,
        pageSize: req.query?.pageSize
      }));
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/receipts/:receiptId/image', async (req, res) => {
    try {
      const receipt = await receiptService.getForAdmin(req.params.receiptId);
      const stat = await receiptStorage.stat(receipt.storage_key);
      res.status(200);
      res.setHeader('Content-Type', receipt.mime_type);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = receiptStorage.createReadStream(receipt.storage_key);
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/receipts/:receiptId', async (req, res) => {
    try {
      const row = await receiptService.getForAdmin(req.params.receiptId);
      return res.json(receiptDto(row, { includePrivate: true }));
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  async function approveReceipt(req, res) {
    try {
      const result = await receiptService.approve({
        receiptId: req.params.receiptId,
        adminId: adminIdentity(req),
        verifiedToman: decimalInput(
          req.body?.verifiedToman ??
          req.body?.verifiedAmountToman ??
          req.body?.amountToman
        ),
        approvedNoa: decimalInput(
          req.body?.approvedNoa ??
          req.body?.manualNoa ??
          req.body?.noaAmount
        ),
        overrideReason: req.body?.overrideReason,
        reviewReason: req.body?.reviewReason ?? req.body?.reason
      });
      await audit(req, 'noa_receipt_approved', result.receiptId, {
        verifiedToman: result.verifiedToman,
        calculatedNoa: result.calculatedNoa,
        approvedNoa: result.approvedNoa,
        manualOverride: result.manualOverride,
        overrideReason: result.overrideReason,
        transactionId: result.approvalTransactionId,
        replayed: result.replayed
      });
      return res.json(result);
    } catch (error) {
      return sendNoaError(res, error);
    }
  }

  async function rejectReceipt(req, res) {
    try {
      const result = await receiptService.reject({
        receiptId: req.params.receiptId,
        adminId: adminIdentity(req),
        reason: req.body?.reason ?? req.body?.reviewReason
      });
      await audit(req, 'noa_receipt_rejected', result.receiptId, {
        reason: result.reviewReason,
        replayed: result.replayed
      });
      return res.json(result);
    } catch (error) {
      return sendNoaError(res, error);
    }
  }

  router.post('/receipts/:receiptId/approve', approveReceipt);
  router.post('/receipts/:receiptId/reject', rejectReceipt);

  router.patch('/receipts/:receiptId', async (req, res) => {
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (status === 'approved' || status === 'approve') {
      return approveReceipt(req, res);
    }
    if (status === 'rejected' || status === 'reject') {
      return rejectReceipt(req, res);
    }
    return res.status(400).json({
      success: false,
      error: 'NOA_INVALID_RECEIPT_STATUS',
      message: 'وضعیت رسید باید approved یا rejected باشد.'
    });
  });

  return router;
}

module.exports = {
  adminIdentity,
  createNoaAdminRouter,
  walletAdjustmentInput,
  requireFinancialAdmin
};
