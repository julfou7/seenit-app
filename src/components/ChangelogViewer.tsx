import React from 'react';
import Markdown from 'react-markdown';

interface ChangelogViewerProps {
  content: string;
}

/**
 * Transforms raw GitHub release text / commit logs into clean, readable release notes.
 */
function cleanReleaseNotes(raw: string): string {
  if (!raw || !raw.trim()) {
    return `### ✨ Nouveautés de cette version
- **Améliorations générales** : Correctifs visuels, optimisations des performances et mise à jour des services.`;
  }

  let text = raw.trim();

  // If text is only a GitHub comparison link
  if (
    text.startsWith('**Full Changelog**') || 
    text.startsWith('Full Changelog:') || 
    (text.includes('compare/v') && text.length < 120)
  ) {
    return `### ✨ Nouveautés de cette version
- **Mises à jour & correctifs** : Améliorations de la stabilité, correctifs d'affichage et optimisations générales.`;
  }

  // Remove boilerplate lines like "**Full Changelog**: https://..." or "## What's Changed"
  const lines = text.split('\n');
  const filteredLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('**Full Changelog**') ||
      trimmed.startsWith('Full Changelog:') ||
      trimmed.startsWith('https://github.com/')
    ) {
      continue;
    }

    // Clean commit logs like "* feat(splash): ... by @username in https://..."
    let cleanedLine = trimmed
      .replace(/\s+by\s+@[\w-]+(?:\s+in\s+https?:\/\/[^\s]+)?/gi, '')
      .replace(/^[\*\-]\s+(feat|fix|perf|refactor|chore)(?:\([^\)]+\))?:\s*/i, (match, type) => {
        const t = type.toLowerCase();
        if (t === 'feat') return '- ✨ **Nouveauté** : ';
        if (t === 'fix') return '- 🛠️ **Correction** : ';
        if (t === 'perf') return '- ⚡ **Performance** : ';
        return '- 🔹 ';
      });

    if (cleanedLine) {
      filteredLines.push(cleanedLine);
    }
  }

  const result = filteredLines.join('\n').trim();
  if (!result) {
    return `### ✨ Nouveautés de cette version
- **Améliorations générales** : Correctifs d'affichage, stabilité et optimisations.`;
  }

  return result;
}

export function ChangelogViewer({ content }: ChangelogViewerProps) {
  const formattedContent = cleanReleaseNotes(content);

  return (
    <div className="text-xs text-zinc-300 space-y-2 leading-relaxed [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-amber-300 [&_h3]:mt-1 [&_h3]:mb-2 [&_h4]:text-xs [&_h4]:font-bold [&_h4]:text-amber-400 [&_ul]:space-y-2 [&_ul]:my-2 [&_li]:list-disc [&_li]:ml-4 [&_strong]:text-white [&_strong]:font-bold [&_p]:my-1">
      <Markdown>{formattedContent}</Markdown>
    </div>
  );
}
