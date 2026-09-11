import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Keep the app shell available for repeat mobile visits without caching API data.
// The update event is consumed by App.tsx so the user stays in control of reloads.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      const announceUpdate = () => {
        if (registration.waiting) {
          window.dispatchEvent(new CustomEvent('macnas-sw-update', {
            detail: { registration },
          }));
        }
      };

      announceUpdate();
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate();
          }
        });
      });
    }).catch(() => {
      // A service worker is an enhancement; the online app remains fully usable.
    });
  });
}
