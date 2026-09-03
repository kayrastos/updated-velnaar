import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { bootstrapDevSession } from './dev/devSessionBootstrap';

if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
  bootstrapDevSession();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
