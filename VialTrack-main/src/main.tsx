import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import './index.css';
import 'leaflet/dist/leaflet.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    const root = createRoot(rootElement);
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
    (window as unknown as { __appMounted?: boolean }).__appMounted = true;
  } catch (renderError) {
    console.error('Fatal root render error:', renderError);
    rootElement.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; font-family: system-ui, sans-serif; padding: 1rem;">
        <div style="max-width: 420px; width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.5rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size: 1.125rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem;">SecondMedic VialTrack</div>
          <p style="font-size: 0.8125rem; color: #64748b; margin-bottom: 1rem;">Unable to mount application. Click below to reload.</p>
          <button onclick="localStorage.clear(); window.location.reload();" style="background: #0369a1; color: white; border: none; border-radius: 0.5rem; padding: 0.5rem 1rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer;">
            Reset & Reload
          </button>
        </div>
      </div>
    `;
  }
}

