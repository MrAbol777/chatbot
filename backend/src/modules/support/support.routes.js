const express = require('express');
const { createRequirePrincipal } = require('../auth/principal');
const { maskPhoneNumber } = require('../admin/common/auth');
const { CATEGORIES, STATUSES } = require('./support.repository');

const categoryLabels = {
  technical: 'خطای فنی',
  account: 'حساب کاربری',
  billing: 'اعتبار و پرداخت',
  suggestion: 'پیشنهاد',
  other: 'موضوع دیگر'
};

const sendError = (res, error) => {
  const messages = {
    SUBJECT_REQUIRED: 'موضوع درخواست را وارد کنید.',
    MESSAGE_REQUIRED: 'متن پیام را وارد کنید.',
    TICKET_NOT_FOUND: 'درخواست پیدا نشد یا دیگر در دسترس نیست.',
    INVALID_STATUS: 'وضعیت درخواست معتبر نیست.'
  };
  const message = messages[error?.message] || 'عملیات پشتیبانی انجام نشد.';
  return res.status(error?.message === 'TICKET_NOT_FOUND' ? 404 : 400).json({ error: error?.message || 'SUPPORT_FAILED', message });
};

const mapAdminItem = (item, role) => ({
  ...item,
  userPhone: maskPhoneNumber(item.userPhone, role)
});

function createSupportUserRouter({ principalResolver, repository }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);

  router.get('/api/support', requirePrincipal, async (req, res, next) => {
    try {
      return res.json({ items: await repository.listForUser(req.authPrincipal.userId) });
    } catch (error) { return next(error); }
  });

  router.post('/api/support', requirePrincipal, async (req, res, next) => {
    try {
      const item = await repository.createTicket({
        userId: req.authPrincipal.userId,
        subject: req.body?.subject,
        category: req.body?.category,
        message: req.body?.message,
        context: req.body?.context
      });
      return res.status(201).json({ item });
    } catch (error) {
      if (['SUBJECT_REQUIRED', 'MESSAGE_REQUIRED', 'USER_REQUIRED'].includes(error?.message)) return sendError(res, error);
      return next(error);
    }
  });

  router.get('/api/support/:id', requirePrincipal, async (req, res, next) => {
    try {
      const item = await repository.getForUser(req.params.id, req.authPrincipal.userId);
      return item ? res.json({ item }) : res.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'درخواست پیدا نشد.' });
    } catch (error) { return next(error); }
  });

  router.post('/api/support/:id/messages', requirePrincipal, async (req, res, next) => {
    try {
      return res.status(201).json({ item: await repository.addUserMessage(req.params.id, req.authPrincipal.userId, req.body?.body) });
    } catch (error) {
      if (['TICKET_NOT_FOUND', 'MESSAGE_REQUIRED'].includes(error?.message)) return sendError(res, error);
      return next(error);
    }
  });

  return router;
}

function createSupportAdminRouter({ requireAdminAuth, requireAdminRole, repository, appendAudit }) {
  const router = express.Router();
  const guard = [requireAdminAuth, requireAdminRole];

  router.get('/support', guard, async (req, res, next) => {
    try {
      const result = await repository.listForAdmin({ status: req.query.status, query: req.query.q, page: req.query.page, pageSize: req.query.pageSize });
      return res.json({ ...result, items: result.items.map((item) => mapAdminItem(item, req.admin?.role)) });
    } catch (error) { return next(error); }
  });

  router.get('/support/:id', guard, async (req, res, next) => {
    try {
      const item = await repository.getForAdmin(req.params.id);
      return item ? res.json({ item: mapAdminItem(item, req.admin?.role) }) : res.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'درخواست پیدا نشد.' });
    } catch (error) { return next(error); }
  });

  router.post('/support/:id/messages', guard, async (req, res, next) => {
    try {
      const item = await repository.addAdminMessage(req.params.id, req.admin?.username, req.body?.body, req.body?.isInternal === true);
      await appendAudit({ adminUsername: req.admin?.username, action: 'support_message_created', target: req.params.id, details: { isInternal: req.body?.isInternal === true } });
      return res.status(201).json({ item: mapAdminItem(item, req.admin?.role) });
    } catch (error) {
      if (['TICKET_NOT_FOUND', 'MESSAGE_REQUIRED'].includes(error?.message)) return sendError(res, error);
      return next(error);
    }
  });

  router.patch('/support/:id', guard, async (req, res, next) => {
    try {
      const item = await repository.updateStatus(req.params.id, req.admin?.username, req.body?.status);
      await appendAudit({ adminUsername: req.admin?.username, action: 'support_ticket_status_updated', target: req.params.id, details: { status: req.body?.status } });
      return res.json({ item: mapAdminItem(item, req.admin?.role) });
    } catch (error) {
      if (['TICKET_NOT_FOUND', 'INVALID_STATUS'].includes(error?.message)) return sendError(res, error);
      return next(error);
    }
  });

  return router;
}

module.exports = { createSupportUserRouter, createSupportAdminRouter, categoryLabels, CATEGORIES, STATUSES };
