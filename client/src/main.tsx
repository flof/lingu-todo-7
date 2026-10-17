import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store.ts';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('no #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void store.init();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
