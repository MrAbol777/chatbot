'use strict';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createChatConcurrencyGate({
  maxPerUser = 2,
  maxGlobal = 20
} = {}) {
  const perUserLimit = positiveInteger(maxPerUser, 2);
  const globalLimit = positiveInteger(maxGlobal, 20);
  const activeByUser = new Map();
  let activeGlobal = 0;

  return (req, res, next) => {
    const userId = typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
      ? String(req.user.id).trim()
      : '';
    if (!userId) {
      return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }

    const userActive = Number(activeByUser.get(userId) || 0);
    if (userActive >= perUserLimit || activeGlobal >= globalLimit) {
      res.setHeader('Retry-After', '2');
      return res.status(429).json({
        error: 'CHAT_CAPACITY_REACHED',
        message: 'چند درخواست همزمان در حال پردازش است. چند لحظه دیگر دوباره تلاش کن.'
      });
    }

    activeGlobal += 1;
    activeByUser.set(userId, userActive + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeGlobal = Math.max(0, activeGlobal - 1);
      const nextUserActive = Math.max(0, Number(activeByUser.get(userId) || 0) - 1);
      if (nextUserActive === 0) activeByUser.delete(userId);
      else activeByUser.set(userId, nextUserActive);
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

module.exports = { createChatConcurrencyGate, positiveInteger };
