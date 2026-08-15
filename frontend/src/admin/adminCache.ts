import { useCallback, useEffect, useRef, useState } from 'react';

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  ttl: number;
};

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs = 45000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  invalidate(prefixOrKey?: string): void {
    if (!prefixOrKey) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key === prefixOrKey || key.startsWith(`${prefixOrKey}:`)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const adminCache = new MemoryCache();

export function useAdminCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 45000
) {
  const [data, setData] = useState<T | null>(() => adminCache.get<T>(key));
  const [loading, setLoading] = useState<boolean>(!adminCache.get<T>(key));
  const [error, setError] = useState<string>('');
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async (bypassCache = false) => {
    if (!bypassCache) {
      const cached = adminCache.get<T>(key);
      if (cached !== null) {
        setData(cached);
        setLoading(false);
        return cached;
      }
    }

    setLoading(true);
    setError('');
    try {
      const fresh = await fetcherRef.current();
      adminCache.set(key, fresh, ttlMs);
      setData(fresh);
      return fresh;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطا در بارگذاری داده‌ها';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [key, ttlMs]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  return { data, loading, error, refresh, setData };
}
