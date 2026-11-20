import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './i18n';
import SpaApp from './SpaApp';
import './globals.css';

ReactDOM.createRoot(document.querySelector('#root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SpaApp />
    </BrowserRouter>
  </React.StrictMode>,
);
