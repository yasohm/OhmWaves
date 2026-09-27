import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// In the phone app, start once Android's splash has handed over to the launch screen (see index.html).
(window.ohmLaunchReady || Promise.resolve()).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Fade the launch screen once the app has painted.
  requestAnimationFrame(() => window.ohmLaunchDone?.());
});
