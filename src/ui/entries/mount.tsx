import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import '../app.css';

export function mount(node: ReactNode) {
  createRoot(document.getElementById('root')!).render(<StrictMode>{node}</StrictMode>);
}
