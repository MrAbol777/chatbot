const normalizeLocalizedDigits = (value) =>
  String(value || '')
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));

const normalizeIranMobileToInternational = (phone) => {
  if (typeof phone !== 'string') {
    throw new Error('phone must be a string');
  }

  const digits = normalizeLocalizedDigits(phone).replace(/\D/g, '');

  if (digits.startsWith('09') && digits.length === 11) {
    return `98${digits.slice(1)}`;
  }

  if (digits.startsWith('989') && digits.length === 12) {
    return digits;
  }

  throw new Error('Invalid Iranian mobile number. Accepted formats: 09XXXXXXXXX, 989XXXXXXXXX, +989XXXXXXXXX');
};

const normalizeIranMobileToLocal = (value) => {
  if (typeof value !== 'string') return '';
  const cleaned = normalizeLocalizedDigits(value).trim().replace(/[-\s]/g, '');
  if (cleaned.startsWith('+98')) return `0${cleaned.slice(3)}`;
  if (cleaned.startsWith('98')) return `0${cleaned.slice(2)}`;
  return cleaned;
};

const isValidIranMobileLocal = (value) => /^09[0-9]{9}$/.test(value);

const normalizeOtpCode = (value) => {
  const rawCode = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return normalizeLocalizedDigits(rawCode).replace(/\D/g, '');
};

const getIranMobileVariants = (phone) => {
  const raw = String(phone || '').trim();
  const digits = normalizeLocalizedDigits(raw).replace(/\D/g, '');
  const variants = new Set();

  if (digits.startsWith('09') && digits.length === 11) {
    variants.add(digits);
    variants.add(`98${digits.slice(1)}`);
  } else if (digits.startsWith('989') && digits.length === 12) {
    variants.add(digits);
    variants.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('9') && digits.length === 10) {
    variants.add(`0${digits}`);
    variants.add(`98${digits}`);
  } else if (digits) {
    variants.add(digits);
  }

  return Array.from(variants);
};

module.exports = {
  normalizeIranMobileToInternational,
  normalizeIranMobileToLocal,
  isValidIranMobileLocal,
  normalizeOtpCode,
  getIranMobileVariants
};
