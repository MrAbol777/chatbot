import { useCallback, useEffect, useState } from 'react';
import { fetchNoaWallet } from './noa.service';
import type { NoaWallet } from './noa.types';

export function useNoaWallet(enabled: boolean) {
  const [wallet, setWallet] = useState<NoaWallet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setWallet(null);
      setError('');
      return null;
    }
    setLoading(true);
    setError('');
    try {
      const next = await fetchNoaWallet();
      setWallet(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'دریافت موجودی نوآ انجام نشد.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('noa:wallet-changed', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('noa:wallet-changed', refreshWhenVisible);
    };
  }, [enabled, refresh]);

  return { wallet, loading, error, refresh };
}
