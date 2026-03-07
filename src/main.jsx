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
