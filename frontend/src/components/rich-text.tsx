import { cn } from 'cn';
import type { ReactNode } from 'react';
import { asRichDoc, type RichBlock, type RichInline, type RichListItem, safeHref } from '@/lib/rich';

/**
 * Mostra um texto formatado (RN-136) montando elementos React a partir do documento: nunca HTML cru nem
 * `dangerouslySetInnerHTML`, e só a lista fixa de nós/marcas. Sem documento (texto antigo, ou enviado pela
 * API de integração), mostra o texto puro com as quebras de linha.
 */
export function RichText({ rich, plain, className }: { rich: unknown; plain?: string | null; className?: string }) {
  const doc = asRichDoc(rich);
  if (!doc) {
    return plain ? <p className={cn('whitespace-pre-wrap break-words', className)}>{plain}</p> : null;
  }
  return <div className={cn('rich-text space-y-2 break-words', className)}>{renderBlocks(doc.content)}</div>;
}

function renderBlocks(blocks: readonly RichBlock[]): ReactNode {
  return blocks.map((block, i) => {
    const key = `${block.type}-${i}`;
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={key} className="min-h-[1lh]">
            {renderInline(block.content)}
          </p>
        );
      case 'blockquote':
        return (
          <blockquote key={key} className="space-y-2 border-s-2 border-border ps-3 text-muted-foreground">
            {renderBlocks(block.content)}
          </blockquote>
        );
      case 'bulletList':
        return (
          <ul key={key} className="list-disc space-y-1 ps-5">
            {renderItems(block.content, key)}
          </ul>
        );
      case 'orderedList':
        return (
          <ol key={key} className="list-decimal space-y-1 ps-5">
            {renderItems(block.content, key)}
          </ol>
        );
      default:
        return null;
    }
  });
}

/** O documento é só leitura e nunca é reordenado: a posição é uma chave estável. */
function renderItems(items: readonly RichListItem[], key: string): ReactNode {
  return items.map((item, j) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lista só de leitura, sem reordenar
    <li key={`${key}-${j}`}>{renderBlocks(item.content)}</li>
  ));
}

function renderInline(nodes: readonly RichInline[] | undefined): ReactNode {
  return (nodes ?? []).map((node, i) => {
    const key = `${node.type}-${i}`;
    if (node.type === 'hardBreak') return <br key={key} />;
    if (node.type !== 'text') return null;
    let out: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') out = <strong>{out}</strong>;
      else if (mark.type === 'italic') out = <em>{out}</em>;
      else if (mark.type === 'link') {
        const href = safeHref(mark.attrs.href);
        if (href) {
          out = (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-primary underline underline-offset-2"
            >
              {out}
            </a>
          );
        }
      }
    }
    return <span key={key}>{out}</span>;
  });
}
