import { cn } from 'cn';
import { UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials, photoUrl } from '@/lib/initials';

export interface AvatarPerson {
  id?: string | null;
  name?: string | null;
  photoVersion?: string | null;
}

/**
 * O avatar de uma pessoa em qualquer tela (RN-142): a foto, se houver; senão as iniciais sobre a cor da
 * marca (o par `primary`/`primary-foreground`, conferido no contraste). Sem nome (opt-out, anonimizado,
 * colaborador anônimo) mostra um ícone genérico. Ao lado do nome é decorativo; sozinho, `label` dá o nome.
 */
export function PersonAvatar({
  person,
  size = 'default',
  label,
  className,
}: {
  person: AvatarPerson | null | undefined;
  size?: 'sm' | 'default' | 'lg';
  /** Nome acessível quando o avatar aparece sozinho (sem o nome escrito ao lado). */
  label?: string;
  className?: string;
}) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  const name = person?.name?.trim();
  if (!name) {
    return (
      <Avatar size={size} className={className} {...a11y}>
        <AvatarFallback>
          <UserRound className="size-[60%]" aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
    );
  }
  return (
    <Avatar size={size} className={className} {...a11y}>
      {person?.id && person.photoVersion && <AvatarImage src={photoUrl(person.id, person.photoVersion)} alt="" />}
      <AvatarFallback className={cn('bg-primary font-medium text-primary-foreground')}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
