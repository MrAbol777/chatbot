'use strict';

const { noaError } = require('./noa.errors');

const POW10 = [1n];
for (let index = 1; index <= 36; index += 1) {
  POW10[index] = POW10[index - 1] * 10n;
}

const powerOfTen = (scale) => {
  if (!Number.isInteger(scale) || scale < 0 || scale >= POW10.length) {
    throw new TypeError('fixed-point scale is out of range');
  }
  return POW10[scale];
};

const inputToString = (input, fieldName) => {
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'bigint') return input.toString();
  if (typeof input === 'number' && Number.isSafeInteger(input)) return String(input);
  throw noaError(
    'NOA_INVALID_DECIMAL',
    `${fieldName} باید به‌صورت رشتهٔ عددی دقیق ارسال شود.`,
    400,
    { field: fieldName }
  );
};

function parseFixed(input, {
  scale,
  fieldName = 'amount',
  allowZero = true,
  allowNegative = false,
  maxIntegerDigits = 18
} = {}) {
  const raw = inputToString(input, fieldName);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw noaError('NOA_INVALID_DECIMAL', `${fieldName} معتبر نیست.`, 400, { field: fieldName });
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = match[2].replace(/^0+(?=\d)/, '');
  const fractionPart = match[3] || '';

  if (sign < 0n && !allowNegative) {
    throw noaError('NOA_INVALID_DECIMAL', `${fieldName} نمی‌تواند منفی باشد.`, 400, { field: fieldName });
  }
  if (integerPart.length > maxIntegerDigits || fractionPart.length > scale) {
    throw noaError(
      'NOA_DECIMAL_OUT_OF_RANGE',
      `دقت یا اندازهٔ ${fieldName} بیش از حد مجاز است.`,
      400,
      { field: fieldName }
    );
  }

  const paddedFraction = fractionPart.padEnd(scale, '0');
  const absoluteUnits =
    BigInt(integerPart || '0') * powerOfTen(scale) +
    BigInt(paddedFraction || '0');
  const units = absoluteUnits * sign;

  if (!allowZero && units === 0n) {
    throw noaError('NOA_INVALID_DECIMAL', `${fieldName} باید بزرگ‌تر از صفر باشد.`, 400, { field: fieldName });
  }

  return {
    units,
    scale,
    value: formatFixed(units, scale)
  };
}

function formatFixed(units, scale) {
  const value = typeof units === 'bigint' ? units : BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = powerOfTen(scale);
  const integerPart = absolute / divisor;
  if (scale === 0) return `${negative ? '-' : ''}${integerPart}`;
  const fractionPart = (absolute % divisor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

function divideAndRoundHalfUp(numerator, denominator) {
  if (denominator <= 0n) throw new TypeError('denominator must be positive');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function multiplyFixed(left, right, outputScale) {
  const numerator = left.units * right.units * powerOfTen(outputScale);
  const denominator = powerOfTen(left.scale + right.scale);
  const units = divideAndRoundHalfUp(numerator, denominator);
  return {
    units,
    scale: outputScale,
    value: formatFixed(units, outputScale)
  };
}

function divideFixed(numerator, denominator, outputScale) {
  if (denominator.units <= 0n) {
    throw noaError('NOA_INVALID_EXCHANGE_RATE', 'نرخ تبدیل Noa معتبر نیست.', 503);
  }
  const scaledNumerator =
    numerator.units *
    powerOfTen(denominator.scale + outputScale);
  const scaledDenominator =
    denominator.units *
    powerOfTen(numerator.scale);
  const units = divideAndRoundHalfUp(scaledNumerator, scaledDenominator);
  return {
    units,
    scale: outputScale,
    value: formatFixed(units, outputScale)
  };
}

function addFixed(...values) {
  if (values.length === 0) throw new TypeError('at least one value is required');
  const scale = values[0].scale;
  if (values.some((value) => value.scale !== scale)) {
    throw new TypeError('fixed-point scales must match');
  }
  const units = values.reduce((sum, value) => sum + value.units, 0n);
  return { units, scale, value: formatFixed(units, scale) };
}

module.exports = {
  addFixed,
  divideFixed,
  formatFixed,
  multiplyFixed,
  parseFixed,
  powerOfTen
};
