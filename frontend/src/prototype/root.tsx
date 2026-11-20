import { Outlet } from '@tanstack/react-router';
import { PrototypeSwitcher, ThemeProvider } from './theme';

/** Protótipos do M0V, mantidos só como referência visual até as telas reais do M2 os substituírem. */
export function PrototypeRoot() {
  return (
    <ThemeProvider>
      <Outlet />
      <PrototypeSwitcher />
    </ThemeProvider>
  );
}
