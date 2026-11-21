import { BASE_PATH } from '../../site';

/**
 * Raiz da ajuda na instalação (/ajuda/): não há página inicial, só a escolha do idioma. Vai para o
 * idioma do ITS guardado neste navegador (its-lang) ou o do navegador; sem JavaScript, os dois links.
 */
const SCRIPT = `(function () {
  var lang;
  try { lang = localStorage.getItem('its-lang'); } catch (e) {}
  if (lang !== 'pt-BR' && lang !== 'en') {
    lang = /^en\\b/i.test(navigator.language || '') ? 'en' : 'pt-BR';
  }
  location.replace(${JSON.stringify(`${BASE_PATH}/`)} + lang + '/');
})();`;

export function Redirecionar() {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script fixo do projeto, sem dados de fora */}
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <div className="space-y-3">
        <p>Ajuda do ITS · ITS Help</p>
        <p className="space-x-6 font-semibold">
          <a className="text-primary underline-offset-4 hover:underline" href={`${BASE_PATH}/pt-BR/`} hrefLang="pt-BR">
            Português
          </a>
          <a
            className="text-primary underline-offset-4 hover:underline"
            href={`${BASE_PATH}/en/`}
            hrefLang="en"
            lang="en"
          >
            English
          </a>
        </p>
      </div>
    </main>
  );
}
