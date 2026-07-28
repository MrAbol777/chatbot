'use strict';

const express = require('express');
const multer = require('multer');
const { RECEIPT_MAX_BYTES } = require('./noa.constants');
const { sha256 } = require('./noa.crypto');
const { noaError, sendNoaError } = require('./noa.errors');

function requireAuthenticatedUser(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'NOA_AUTH_REQUIRED',
      message: 'برای استفاده از کیف پول Noa ابتدا وارد حساب کاربری شوید.'
    });
  }
  req.user.id = userId;
  return next();
}

function decimalInput(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
}

function createNoaUserRouter({
  billingService,
  receiptService,
  receiptStorage,
  authMiddleware
}) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: RECEIPT_MAX_BYTES,
      fields: 10,
      fieldSize: 16 * 1024
    }
  }).fields([
    { name: 'receipt', maxCount: 1 },
    { name: 'receiptImage', maxCount: 1 }
  ]);

  // Public, read-only pricing lets the landing page reflect the live database
  // configuration. It does not authorize any AI operation or expose a wallet.
  router.get('/config', async (_req, res) => {
    try {
      return res.json(await billingService.getConfig());
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  if (authMiddleware) router.use(authMiddleware);
  router.use(requireAuthenticatedUser);

  router.get('/wallet', async (req, res) => {
    try {
      const [wallet, config] = await Promise.all([
        billingService.getBalance(req.user.id),
        billingService.getConfig()
      ]);
      return res.json({ ...wallet, exchangeRate: config.exchangeRate });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/balance', async (req, res) => {
    try {
      const [wallet, config] = await Promise.all([
        billingService.getBalance(req.user.id),
        billingService.getConfig()
      ]);
      return res.json({ ...wallet, exchangeRate: config.exchangeRate });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/transactions', async (req, res) => {
    try {
      const items = await billingService.listTransactions(req.user.id, {
        limit: req.query?.limit
      });
      return res.json({ items });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.post('/receipts', (req, res) => {
    upload(req, res, async (uploadError) => {
      if (uploadError) {
        const tooLarge = uploadError instanceof multer.MulterError &&
          uploadError.code === 'LIMIT_FILE_SIZE';
        return sendNoaError(
          res,
          noaError(
            tooLarge ? 'NOA_RECEIPT_FILE_TOO_LARGE' : 'NOA_RECEIPT_UPLOAD_FAILED',
            tooLarge
              ? 'حجم تصویر رسید نباید بیشتر از ۵ مگابایت باشد.'
              : 'بارگذاری تصویر رسید ناموفق بود.',
            tooLarge ? 413 : 400
          )
        );
      }

      const file = req.files?.receipt?.[0] || req.files?.receiptImage?.[0];
      if (!file?.buffer) {
        return sendNoaError(
          res,
          noaError(
            'NOA_RECEIPT_FILE_REQUIRED',
            'تصویر رسید الزامی است.',
            400,
            { field: 'receipt' }
          )
        );
      }

      let stored = null;
      try {
        const idempotencyKey = String(
          req.get('Idempotency-Key') || req.body?.idempotencyKey || ''
        ).trim();
        if (!idempotencyKey) {
          throw noaError(
            'NOA_IDEMPOTENCY_KEY_REQUIRED',
            'هدر Idempotency-Key الزامی است.',
            400
          );
        }
        stored = await receiptStorage.save({
          buffer: file.buffer,
          originalFileName: file.originalname
        });
        const result = await receiptService.submit({
          userId: req.user.id,
          idempotencyKey,
          storageKey: stored.storageKey,
          originalFileName: stored.originalFileName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          fileSha256: stored.fileSha256 || sha256(file.buffer)
        });
        if (result.replayed) {
          await receiptStorage.remove(stored.storageKey).catch(() => {});
        }
        return res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        if (stored?.storageKey) {
          await receiptStorage.remove(stored.storageKey).catch(() => {});
        }
        return sendNoaError(res, error);
      }
    });
  });

  router.get('/receipts', async (req, res) => {
    try {
      const items = await receiptService.listForUser(req.user.id, {
        limit: req.query?.limit
      });
      return res.json({ items });
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  router.get('/receipts/:receiptId/image', async (req, res) => {
    try {
      const receipt = await receiptService.getForUser(
        req.params.receiptId,
        req.user.id
      );
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
      const row = await receiptService.getForUser(
        req.params.receiptId,
        req.user.id
      );
      const items = await receiptService.listForUser(req.user.id, { limit: 100 });
      const receipt = items.find((item) => item.receiptId === String(row.receipt_id));
      return res.json(receipt);
    } catch (error) {
      return sendNoaError(res, error);
    }
  });

  return router;
}

module.exports = {
  createNoaUserRouter,
  decimalInput,
  requireAuthenticatedUser
};
