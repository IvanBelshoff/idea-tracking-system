import { useEffect } from 'react';

/** Título da aba: "Página · Organização" (ajuda leitor de tela e quem tem várias abas abertas). */
export function usePageTitle(page: string, organization?: string): void {
  useEffect(() => {
    document.title = [page, organization || 'ITS'].filter(Boolean).join(' · ');
  }, [page, organization]);
}
