import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './design-system/tokens/tokens.css';
import './design-system/styles/base.css';
import './design-system/styles/components.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
