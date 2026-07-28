'use strict';

const { noaError } = require('./noa.errors');

// Deliberately immutable until a reviewed gateway implementation is shipped.
const PAYMENT_GATEWAY_ENABLED = false;

function createPaymentGatewaySkeleton() {
  return Object.freeze({
    enabled: PAYMENT_GATEWAY_ENABLED,
    async createTopUp() {
      throw noaError(
        'NOA_PAYMENT_GATEWAY_DISABLED',
        'درگاه پرداخت در حال حاضر فعال نیست.',
        503
      );
    },
    async handleCallback() {
      throw noaError(
        'NOA_PAYMENT_GATEWAY_DISABLED',
        'درگاه پرداخت در حال حاضر فعال نیست.',
        503
      );
    }
  });
}

module.exports = {
  PAYMENT_GATEWAY_ENABLED,
  createPaymentGatewaySkeleton
};
