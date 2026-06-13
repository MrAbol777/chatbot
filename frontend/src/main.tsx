import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './design-system/tokens/tokens.css';
import './design-system/styles/base.css';
import './design-system/styles/components.css';
import './styles.css';

// Global unhandled error/rejection listeners (production-safe)
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

window.addEventListener('error', (event) => {
  console.error('[window:error]', event.message, event.filename, event.lineno, event.error);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
