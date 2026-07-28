const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
}

export function normalizePositiveDecimal(value: string, fractionDigits = 6): string | null {
  const normalized = toAsciiDigits(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.slice(0, fractionDigits).replace(/0+$/, '');
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  if (BigInt(whole) === 0n && (!fraction || BigInt(fraction) === 0n)) return null;
  return canonical;
}

type DecimalParts = {
  integer: bigint;
  scale: number;
  negative: boolean;
};

function parseDecimal(value: string): DecimalParts | null {
  const normalized = toAsciiDigits(value).trim();
  const match = normalized.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[3] || '';
  return {
    integer: BigInt(`${match[2]}${fraction}`),
    scale: fraction.length,
    negative: Boolean(match[1])
  };
}

function pow10(power: number): bigint {
  return 10n ** BigInt(Math.max(0, power));
}

export function divideDecimal(dividend: string, divisor: string, outputScale = 6): string | null {
  const left = parseDecimal(dividend);
  const right = parseDecimal(divisor);
  if (!left || !right || right.integer === 0n || left.negative || right.negative) return null;

  const numerator = left.integer * pow10(outputScale + right.scale);
  const denominator = right.integer * pow10(left.scale);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;

  const padded = quotient.toString().padStart(outputScale + 1, '0');
  if (outputScale === 0) return padded;
  const whole = padded.slice(0, -outputScale) || '0';
  const fraction = padded.slice(-outputScale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function multiplyDecimal(leftValue: string, rightValue: string, outputScale = 6): string | null {
  const left = parseDecimal(leftValue);
  const right = parseDecimal(rightValue);
  if (!left || !right || left.negative || right.negative) return null;

  const sourceScale = left.scale + right.scale;
  const product = left.integer * right.integer;
  let result: bigint;
  if (sourceScale <= outputScale) {
    result = product * pow10(outputScale - sourceScale);
  } else {
    const denominator = pow10(sourceScale - outputScale);
    result = product / denominator;
    if ((product % denominator) * 2n >= denominator) result += 1n;
  }
  const padded = result.toString().padStart(outputScale + 1, '0');
  if (outputScale === 0) return padded;
  const whole = padded.slice(0, -outputScale) || '0';
  const fraction = padded.slice(-outputScale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatDecimalFa(value: string | null | undefined, maximumFractionDigits = 6): string {
  if (!value) return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits,
    minimumFractionDigits: 0
  }).format(parsed);
}

export function formatTomanFa(value: string | null | undefined): string {
  if (!value) return '—';
  return `${formatDecimalFa(value, 0)} تومان`;
}
