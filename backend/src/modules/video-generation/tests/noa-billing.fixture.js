'use strict';

function createNoaBillingFixture(overrides = {}) {
  return {
    quote: async ({ actionKey, quantity = '1' }) => ({
      actionKey,
      unit: actionKey === 'video_generation' ? 'second' : 'operation',
      quantity: String(quantity),
      unitPriceNoa: '0.800000',
      amountNoa: String(Number(quantity) * 0.8),
      pricingVersion: 1
    }),
    reserve: async (input) => ({
      reservationId: `noa-${input.referenceId}`,
      amountNoa: String(Number(input.quantity || 1) * 0.8),
      unitPriceNoa: '0.800000',
      status: 'reserved'
    }),
    capture: async (reservationId) => ({ reservationId, status: 'captured' }),
    release: async (reservationId) => ({ reservationId, status: 'released' }),
    ...overrides
  };
}

module.exports = { createNoaBillingFixture };
