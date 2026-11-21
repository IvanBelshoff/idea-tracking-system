import { Inicio } from '~/components/home/inicio';
import { Redirecionar } from '~/components/home/redirecionar';
import { PUBLICA } from '~/site';

/** A raiz: a página inicial só na ajuda pública; na instalação, a ajuda abre direto na documentação. */
export default function RootPage() {
  return PUBLICA ? <Inicio /> : <Redirecionar />;
}
