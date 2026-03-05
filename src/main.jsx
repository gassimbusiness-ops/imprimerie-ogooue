import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './services/auth';
import App from './app';
import './index.css';
import { seedDatabase } from './services/seed';
import { loadImportedData } from './services/import-loader';
import { seedPapeterieProject, seedInventaire } from './utils/seed-data';

seedDatabase().then(() => loadImportedData()).then(() => {
  seedPapeterieProject();
  seedInventaire();
  // Seed client test user for portal access
  const KEY = 'io_employes';
  try {
    const emps = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!emps.find((e) => e.email === 'client.test@gmail.com')) {
      emps.push({
        id: crypto.randomUUID(),
        nom: 'Test',
        prenom: 'Client',
        email: 'client.test@gmail.com',
        role: 'client',
        poste: 'Client externe',
        telephone: '+241 77 00 00 00',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      localStorage.setItem(KEY, JSON.stringify(emps));
    }
  } catch {}
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
