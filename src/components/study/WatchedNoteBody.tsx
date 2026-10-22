import type { ReactElement } from 'react';

type Block = { kind: 'heading' | 'paragraph' | 'source'; text: string } | { kind: 'list'; items: string[] };

/** A small text-only view; the original Markdown is kept for persistence/export. */
function blocks(markdown: string): Block[] {
  const result: Block[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const heading = /^###\s+(.+)$/.exec(line);
    const source = /^来源[：:]\s*(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (heading) result.push({ kind: 'heading', text: heading[1] });
    else if (source) result.push({ kind: 'source', text: line });
    else if (item) {
      const last = result.at(-1);
      if (last?.kind === 'list') last.items.push(item[1]);
      else result.push({ kind: 'list', items: [item[1]] });
    } else result.push({ kind: 'paragraph', text: line });
  }
  return result;
}

export function WatchedNoteBody({ markdown }: { markdown: string }): ReactElement {
  return <div className="space-y-3 break-words">
    {blocks(markdown).map((block, index): ReactElement => {
      if (block.kind === 'heading') return <h3 key={index} className="pt-1 text-sm font-semibold leading-6 text-text">{block.text}</h3>;
      if (block.kind === 'source') return <p key={index} className="rounded-lg bg-brand-soft px-3 py-2 text-xs leading-5 text-brand-ink">{block.text}</p>;
      if (block.kind === 'list') return <ul key={index} className="list-disc space-y-2 pl-5 text-sm leading-6 text-textSub">{block.items.map((item, itemIndex): ReactElement => <li key={itemIndex}>{item}</li>)}</ul>;
      return <p key={index} className="whitespace-pre-wrap text-sm leading-7 text-textSub">{block.text}</p>;
    })}
  </div>;
}
