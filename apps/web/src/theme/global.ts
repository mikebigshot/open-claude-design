import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }

  html, body, #root {
    height: 100%;
  }

  body {
    margin: 0;
    font-family: ${(p) => p.theme.fonts.sans};
    color: ${(p) => p.theme.colors.fg100};
    background: ${(p) => p.theme.colors.bg100};
    -webkit-font-smoothing: antialiased;
    font-feature-settings: 'ss01', 'cv11';
  }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb {
    background: ${(p) => p.theme.colors.line200};
    border-radius: 4px;
  }
  ::-webkit-scrollbar-track { background: transparent; }
`;
