'use client';

import Link from 'next/link';
import { ALL_PAGES, pageHref } from '../../content/nav';
import { RULES } from '../../content/regras';
import { useLang, useMessages } from './use-lang';

/** Todas as regras em linguagem simples, cada uma com âncora (#rn-05) e onde aprender na prática. */
export function TabelaDeRegras() {
  const lang = useLang();
  const t = useMessages().rules;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{t.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.id}</th>
            <th scope="col">{t.rule}</th>
            <th scope="col">{t.where}</th>
          </tr>
        </thead>
        <tbody>
          {[...RULES]
            .sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)))
            .map((r) => {
              const page = ALL_PAGES.find((p) => p.slug === r.where);
              return (
                <tr key={r.id} id={r.id.toLowerCase()} className="scroll-mt-20">
                  <td className="font-mono text-xs whitespace-nowrap">{r.id}</td>
                  <td>{r.text[lang]}</td>
                  <td className="whitespace-nowrap">
                    {page && <Link href={pageHref(lang, page.slug)}>{page.title[lang]}</Link>}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
