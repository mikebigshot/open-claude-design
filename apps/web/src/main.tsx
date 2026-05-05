import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import { theme } from './theme/theme';
import { GlobalStyle } from './theme/global';
import { I18nProvider } from './i18n';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
