type ClarityCommand = (...args: unknown[]) => void;

declare global {
  interface Window {
    clarity?: ClarityCommand & { q?: unknown[][] };
  }
}

const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID || 'y6vqagy1iz';
const CLARITY_SCRIPT_ATTRIBUTE = 'data-danoa-clarity';

let isClarityInitialized = false;

/**
 * Loads Clarity once in production. The project ID is public by design, but
 * can be overridden at build time with VITE_CLARITY_PROJECT_ID.
 */
export function initializeClarity() {
  if (!import.meta.env.PROD || !CLARITY_PROJECT_ID || isClarityInitialized || typeof document === 'undefined') {
    return;
  }

  if (document.querySelector(`script[${CLARITY_SCRIPT_ATTRIBUTE}]`)) {
    isClarityInitialized = true;
    return;
  }

  const clarity = ((...args: unknown[]) => {
    clarity.q = clarity.q || [];
    clarity.q.push(args);
  }) as ClarityCommand & { q?: unknown[][] };

  window.clarity = clarity;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_PROJECT_ID)}`;
  script.setAttribute(CLARITY_SCRIPT_ATTRIBUTE, 'true');
  script.onerror = () => {
    isClarityInitialized = false;
  };

  document.head.appendChild(script);
  isClarityInitialized = true;
}
