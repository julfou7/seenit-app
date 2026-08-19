import React from 'react';
import Markdown from 'react-markdown';

interface ChangelogViewerProps {
  content: string;
}

export function ChangelogViewer({ content }: ChangelogViewerProps) {
  if (!content) {
    return (
      <p className="text-xs text-zinc-400 italic">
        Améliorations générales et optimisations des performances.
      </p>
    );
  }

  return (
    <div className="text-xs text-zinc-300 space-y-2 leading-relaxed [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-amber-300 [&_h3]:mt-2 [&_h3]:mb-1 [&_h4]:text-xs [&_h4]:font-bold [&_h4]:text-amber-400 [&_ul]:space-y-1.5 [&_ul]:my-1.5 [&_li]:flex [&_li]:items-start [&_li]:gap-1.5 [&_strong]:text-white [&_strong]:font-bold [&_p]:my-1">
      <Markdown>{content}</Markdown>
    </div>
  );
}
