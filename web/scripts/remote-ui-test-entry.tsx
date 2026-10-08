import React from 'react';
import { createRoot } from 'react-dom/client';
import { TailscaleSettingsSection } from '../src/pages/settings/TailscaleSettingsSection';
import '../src/index.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="max-w-5xl mx-auto p-4"><TailscaleSettingsSection /></main></React.StrictMode>);
