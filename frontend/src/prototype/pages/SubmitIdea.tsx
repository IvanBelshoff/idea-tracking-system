import { Link } from '@tanstack/react-router';
import { Flag, Paperclip, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CAMPAIGNS, CATEGORIES, ENTITIES, IDEAS, type Idea } from '../data';
import { JourneyMini } from '../journey';
import { CategoryTag, IdCode, StatusBadge } from '../status';

/** Ideias semelhantes (RN-57): no protótipo, palavras em comum no título. */
function useSimilar(title: string) {
  return useMemo(() => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
    const words = norm(title)
      .split(/\W+/)
      .filter((w) => w.length > 3);
    if (words.length === 0) return [];
    return IDEAS.filter((i) => i.status !== 'rejected' && words.some((w) => norm(i.title).includes(w))).slice(0, 3);
  }, [title]);
}

const FIELD = 'h-11 text-base md:h-10 md:text-sm';

const NEW_IDEA: Idea = {
  code: 'ITS-2026-0061',
  title: '',
  description: '',
  status: 'submitted',
  entity: '',
  category: '',
  author: '',
  coAuthors: [],
  submittedAt: '2026-11-04',
  slaDueAt: '2026-11-14',
  supporters: 0,
  steps: [],
  timeline: [],
  comments: [],
};

export function SubmitIdea() {
  const [title, setTitle] = useState('');
  const [sent, setSent] = useState(false);
  const similar = useSimilar(title);

  if (sent) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="text-[1.75rem] leading-tight font-bold">Sua ideia foi enviada</h1>
        <p className="mt-2 text-muted-foreground">Obrigado por contar. A equipe de melhoria responde até 14/11/2026.</p>
        <div className="mt-6 space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <IdCode code={NEW_IDEA.code} size="lg" />
            <StatusBadge status="submitted" />
          </div>
          <JourneyMini idea={NEW_IDEA} />
          <p className="text-sm text-muted-foreground">
            Guarde o código: com ele qualquer pessoa consulta o andamento, mesmo sem login.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg" className="h-12 text-base sm:h-10 sm:text-sm">
            <Link to="/prototipo/minhas-ideias">Acompanhar minhas ideias</Link>
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12 text-base sm:h-10 sm:text-sm"
            onClick={() => setSent(false)}
          >
            Enviar outra ideia
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-[1.75rem] leading-tight font-bold">Enviar ideia</h1>
      <p className="mt-1.5 text-muted-foreground">Conte o problema que você percebeu. Leva menos de um minuto.</p>

      <p className="mt-5 flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 text-sm">
        <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          <strong className="font-semibold">Campanha ativa:</strong> {CAMPAIGNS[0]}
        </span>
      </p>

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(true);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="title" className="text-[0.95rem]">
            Dê um título curto
          </Label>
          <Input
            id="title"
            required
            className={FIELD}
            placeholder="Ex.: Trocar a lâmpada do corredor B"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {similar.length > 0 && (
          <section aria-live="polite" aria-labelledby="similar-title" className="rounded-lg border bg-card p-4">
            <h2 id="similar-title" className="flex items-center gap-2 text-[0.95rem] font-semibold">
              <Users aria-hidden="true" className="size-4 text-primary" />
              Alguém já sugeriu algo parecido?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Apoiar uma ideia existente une os pedidos, e você vira coautor.
            </p>
            <ul className="mt-3 divide-y">
              {similar.map((i) => (
                <li key={i.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <StatusBadge status={i.status} />
                      {i.supporters > 0 && <span>{i.supporters} apoios</span>}
                    </div>
                  </div>
                  <Button type="button" variant="outline" className="h-10">
                    Apoiar esta ideia
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="space-y-2">
          <Label htmlFor="description" className="text-[0.95rem]">
            O que acontece hoje?
          </Label>
          <Textarea
            id="description"
            required
            rows={4}
            className="text-base md:text-sm"
            placeholder="Onde é, quando acontece e com que frequência."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="solution" className="text-[0.95rem]">
            Tem uma sugestão de solução? <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea id="solution" rows={3} className="text-base md:text-sm" />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="entity" className="text-[0.95rem]">
              Onde?
            </Label>
            <Select required>
              <SelectTrigger id="entity" className={`w-full ${FIELD}`}>
                <SelectValue placeholder="Escolha a área" />
              </SelectTrigger>
              <SelectContent>
                {ENTITIES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="category" className="text-[0.95rem]">
              Tipo de melhoria <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Select>
              <SelectTrigger id="category" className={`w-full ${FIELD}`}>
                <SelectValue placeholder="Escolha o tipo" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    <CategoryTag name={c} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="files" className="text-[0.95rem]">
            Fotos ou anexos <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <label
            htmlFor="files"
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md border border-dashed border-input px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <Paperclip aria-hidden="true" className="size-5 shrink-0" />
            Tirar foto ou escolher arquivo (até 5, imagens ou PDF)
          </label>
          <input id="files" type="file" multiple accept="image/*,.pdf" className="sr-only" />
        </div>

        <Button type="submit" size="lg" className="h-12 w-full text-base">
          Enviar ideia
        </Button>
      </form>
    </div>
  );
}
