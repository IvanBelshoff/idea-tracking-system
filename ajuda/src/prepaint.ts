/**
 * Script inline, antes da primeira pintura. A ajuda mora no mesmo endereço do ITS (/ajuda/), então
 * lê o que o ITS guardou no navegador e abre com a cara da instalação: tema (claro/escuro), cor da
 * marca, fonte e favicon da organização. Mesmas regras de validação do frontend/index.html: só
 * valores no formato que o ITS grava entram numa folha de estilo.
 */
export const PREPAINT = `(() => {
  var d = document.documentElement;
  var ok = /^oklch\\([0-9. ]+\\)$/;
  var mode, font, fav, icon, b, s;
  var vars = function (p) {
    return '--brand:' + p.brand + ';--brand-fg:' + p.brandFg + ';--shell-active:' + p.shellActive +
      ';--shell-active-foreground:' + p.shellActiveFg;
  };
  try {
    mode = localStorage.getItem('its-theme-mode');
    if (mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) {
      d.classList.add('dark');
    }
    font = localStorage.getItem('its-font');
    if (font === 'inter' || font === 'atkinson' || font === 'plex') d.dataset.font = font;
    fav = localStorage.getItem('its-favicon');
    icon = document.querySelector('link[rel="icon"]');
    if (icon && fav && fav.indexOf('data:image/svg+xml,') === 0) icon.setAttribute('href', fav);
    b = JSON.parse(localStorage.getItem('its-branding') || 'null');
    if (!b || !b.light || !b.dark) return;
    if (![b.light, b.dark].every(function (p) {
      return [p.brand, p.brandFg, p.shellActive, p.shellActiveFg].every(function (v) { return ok.test(v); });
    })) return;
    s = document.createElement('style');
    s.id = 'org-brand';
    s.textContent = 'html:root{' + vars(b.light) + '}html:root.dark{' + vars(b.dark) + '}';
    document.head.appendChild(s);
  } catch (e) {}
})();`;
