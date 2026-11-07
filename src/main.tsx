import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startTranslator } from './i18n';
import { useApp } from './store';
import { App } from './ui/App';
import './styles.css';

// dev-only handle for debugging sessions from the browser console
if (import.meta.env.DEV) (window as unknown as { __app: typeof useApp }).__app = useApp;

// English is applied to the page as React draws it (see src/i18n)
startTranslator();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
