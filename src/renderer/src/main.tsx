import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { MiniSession } from './MiniSession';
import './styles.css';

const isMini = new URLSearchParams(window.location.search).get('view') === 'mini';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isMini ? <MiniSession /> : <App />}
  </React.StrictMode>,
);
