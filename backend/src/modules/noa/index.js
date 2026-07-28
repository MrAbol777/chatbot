'use strict';

const { createAuthMiddleware } = require('../image-generation/auth.middleware');
const { createNoaAdminRouter } = require('./noa.admin.routes');
const { createNoaBillingService } = require('./noa-billing.service');
const { createNoaReceiptService } = require('./noa-receipt.service');
const { createNoaReceiptStorage } = require('./noa-receipt.storage');
const { createNoaRepository } = require('./noa.repository');
const { createNoaUserRouter } = require('./noa.routes');
const { reconcileExpiredNoaOperations } = require('./noa-reconciliation');
const { ensureNoaSchema } = require('./noa.schema');
const constants = require('./noa.constants');
const errors = require('./noa.errors');
const {
  PAYMENT_GATEWAY_ENABLED,
  createPaymentGatewaySkeleton
} = require('./payment-gateway');

function createNoaModule(deps = {}) {
  const db = deps.db;
  const repository = deps.repository || createNoaRepository(db);
  const billingService = deps.billingService || createNoaBillingService({ repository });
  const receiptService = deps.receiptService || createNoaReceiptService({
    repository,
    billingService
  });
  const receiptStorage = deps.receiptStorage || createNoaReceiptStorage({
    rootDirectory: deps.receiptStorageRoot
  });
  const paymentGateway = createPaymentGatewaySkeleton();
  const authMiddleware = deps.requireUserAuth || deps.authMiddleware || (
    deps.authJwtSecret
      ? createAuthMiddleware({ jwtSecret: deps.authJwtSecret, db })
      : null
  );
  const userRouter = createNoaUserRouter({
    billingService,
    receiptService,
    receiptStorage,
    authMiddleware
  });
  const adminRouter = createNoaAdminRouter({
    billingService,
    receiptService,
    receiptStorage,
    requireAdminAuth: deps.requireAdminAuth,
    appendAudit: deps.appendAudit,
    logger: deps.logger
  });

  return {
    adminRouter,
    billingService,
    ensureSchema: () => ensureNoaSchema(db),
    gateway: paymentGateway,
    paymentGatewayEnabled: PAYMENT_GATEWAY_ENABLED,
    receiptService,
    receiptStorage,
    repository,
    router: userRouter,
    userRouter
  };
}

module.exports = {
  PAYMENT_GATEWAY_ENABLED,
  ...constants,
  ...errors,
  createNoaAdminRouter,
  createNoaBillingService,
  createNoaModule,
  createNoaReceiptService,
  createNoaReceiptStorage,
  createNoaRepository,
  createNoaUserRouter,
  ensureNoaSchema,
  reconcileExpiredNoaOperations
};
