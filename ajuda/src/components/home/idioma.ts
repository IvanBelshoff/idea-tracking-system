import { HOME } from './texto';

/** A mesma chave do ITS e da documentação: escolher o idioma aqui vale lá, e vice-versa. */
export const LANG_KEY = 'its-lang';

/**
 * Script inline, antes da primeira pintura da página inicial: escolhe o idioma (o guardado ou o do
 * navegador) e marca `html[data-lang]` e `html[lang]`. O HTML traz os dois idiomas; o CSS mostra só o
 * escolhido, então a página não pisca de um idioma para o outro.
 */
export const LANG_PREPAINT = `(() => {
  var d = document.documentElement, lang;
  try { lang = localStorage.getItem(${JSON.stringify(LANG_KEY)}); } catch (e) {}
  if (lang !== 'pt-BR' && lang !== 'en') lang = /^en\\b/i.test(navigator.language || '') ? 'en' : 'pt-BR';
  d.dataset.lang = lang;
  d.lang = lang;
  if (lang === 'en') document.title = ${JSON.stringify(HOME.en.meta.title)};
})();`;
