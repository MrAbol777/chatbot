import { describe, expect, it } from 'vitest';
import { formatWalletBalanceExactFa } from './decimal';

describe('wallet balance in the chat header', () => {
  it('keeps the exact balance for the tooltip and accessible name', () => {
    expect(formatWalletBalanceExactFa('666666546604803.123456'))
      .toBe('۶۶۶٬۶۶۶٬۵۴۶٬۶۰۴٬۸۰۳٫۱۲۳۴۵۶');
    expect(formatWalletBalanceExactFa('-1234.500000')).toBe('−۱٬۲۳۴٫۵');
    expect(formatWalletBalanceExactFa('0')).toBe('۰');
  });

  it('keeps every digit so the header can clip only what does not fit', () => {
    expect(formatWalletBalanceExactFa('7000000000')).toBe('۷٬۰۰۰٬۰۰۰٬۰۰۰');
    expect(formatWalletBalanceExactFa('123456789012345678901234567890'))
      .toBe('۱۲۳٬۴۵۶٬۷۸۹٬۰۱۲٬۳۴۵٬۶۷۸٬۹۰۱٬۲۳۴٬۵۶۷٬۸۹۰');
    expect(formatWalletBalanceExactFa('0.000001')).toBe('۰٫۰۰۰۰۰۱');
  });

  it('shows a placeholder when the wallet has not loaded', () => {
    expect(formatWalletBalanceExactFa(undefined)).toBe('—');
    expect(formatWalletBalanceExactFa('invalid')).toBe('—');
  });
});
