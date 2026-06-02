import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type ToastVariant = 'default' | 'success' | 'warning' | 'danger';

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextType = {
  pushToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string, variant: ToastVariant = 'default') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, message, variant }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  const contextValue = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="ds-toast-region" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div key={item.id} className="ds-toast" data-variant={item.variant}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
