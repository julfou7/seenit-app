import React from 'react';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';

interface ChangelogViewerProps {
  content: string;
}

/**
 * Fixes missing French accents and apostrophes in release note text.
 */
function fixFrenchFormatting(text: string): string {
  if (!text) return '';
  return text
    // Missing apostrophes
    .replace(/\bd\s+([aáàâeéèêiíìîoóòôuúùûh])/gi, "d'$1")
    .replace(/\bl\s+([aáàâeéèêiíìîoóòôuúùûh])/gi, "l'$1")
    .replace(/\bc\s+est\b/gi, "c'est")
    .replace(/\bn\s+est\b/gi, "n'est")
    .replace(/\bj\s+([aáàâeéèêiíìîoóòôuúùû])/gi, "j'$1")
    .replace(/\bqu\s+([aáàâeéèêiíìîoóòôuúùûh])/gi, "qu'$1")
    .replace(/\bm\s+([aáàâeéèêiíìîoóòôuúùû])/gi, "m'$1")
    .replace(/\bs\s+([aáàâeéèêiíìîoóòôuúùû])/gi, "s'$1")
    // Missing accents & common words
    .replace(/\bpassage a la\b/gi, "passage à la")
    .replace(/\bPassage a la\b/g, "Passage à la")
    .replace(/\bmise a jour\b/gi, "mise à jour")
    .replace(/\bmises a jour\b/gi, "mises à jour")
    .replace(/\ba jour\b/gi, "à jour")
    .replace(/\bA jour\b/g, "À jour")
    .replace(/\bsynthetique\b/gi, "synthétique")
    .replace(/\bsynthetiques\b/gi, "synthétiques")
    .replace(/\becriture\b/gi, "écriture")
    .replace(/\bamelioration\b/gi, "amélioration")
    .replace(/\bameliorations\b/gi, "améliorations")
    .replace(/\bgenerale\b/gi, "générale")
    .replace(/\bgenerales\b/gi, "générales")
    .replace(/\ben-tete\b/gi, "en-tête")
    .replace(/\bentete\b/gi, "en-tête")
    .replace(/\bselecteur\b/gi, "sélecteur")
    .replace(/\bselecteurs\b/gi, "sélecteurs")
    .replace(/\belement\b/gi, "élément")
    .replace(/\belements\b/gi, "éléments")
    .replace(/\bderoulant\b/gi, "déroulant")
    .replace(/\bderoulants\b/gi, "déroulants")
    .replace(/\bfenetre\b/gi, "fenêtre")
    .replace(/\bfenetres\b/gi, "fenêtres")
    .replace(/\bselection\b/gi, "sélection")
    .replace(/\bselections\b/gi, "sélections")
    .replace(/\bprete\b/gi, "prête")
    .replace(/\bpretes\b/gi, "prêtes")
    .replace(/\bsecurite\b/gi, "sécurité")
    .replace(/\bverifier\b/gi, "vérifier")
    .replace(/\bverification\b/gi, "vérification")
    .replace(/\bverifications\b/gi, "vérifications")
    .replace(/\bdeploiement\b/gi, "déploiement")
    .replace(/\bdeploiements\b/gi, "déploiements")
    .replace(/\benregistre\b/gi, "enregistré")
    .replace(/\benregistree\b/gi, "enregistrée")
    .replace(/\benregistres\b/gi, "enregistrés")
    .replace(/\bpersonnalise\b/gi, "personnalisé")
    .replace(/\bpersonnalisee\b/gi, "personnalisée")
    .replace(/\bpersonnalises\b/gi, "personnalisés")
    .replace(/\breorganise\b/gi, "réorganisé")
    .replace(/\breorganisation\b/gi, "réorganisation")
    .replace(/\bgenere\b/gi, "généré")
    .replace(/\bgeneration\b/gi, "génération")
    .replace(/\bcle\b/gi, "clé")
    .replace(/\bcles\b/gi, "clés");
}

/**
 * Transforms raw GitHub release text into clean, readable Markdown preserving multi-level hierarchy.
 */
function cleanReleaseNotes(raw: string): string {
  if (!raw || !raw.trim()) {
    return `### 🛠️ Ce qui a été fait
- Améliorations générales de l'interface, stabilité et optimisations.`;
  }

  let text = raw.trim();

  // If text is only a GitHub comparison link
  if (
    text.startsWith('**Full Changelog**') || 
    text.startsWith('Full Changelog:') || 
    (text.includes('compare/v') && text.length < 120)
  ) {
    return `### 🛠️ Ce qui a été fait
- **Mises à jour & correctifs** : Améliorations de la stabilité, correctifs d'affichage et optimisations générales.`;
  }

  const lines = text.split('\n');
  const filteredLines: string[] = [];

  for (const line of lines) {
    // Determine leading whitespace indentation (e.g. 2 spaces, 4 spaces, tab)
    const matchIndent = line.match(/^(\s+)/);
    const indentSpaces = matchIndent ? matchIndent[1].length : 0;
    const isSubLevel = indentSpaces >= 2;

    let trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('**Full Changelog**') ||
      trimmed.startsWith('Full Changelog:') ||
      trimmed.startsWith('https://github.com/')
    ) {
      continue;
    }

    // Clean commit logs like "* feat(splash): ... by @username in https://..."
    trimmed = trimmed.replace(/\s+by\s+@[\w-]+(?:\s+in\s+https?:\/\/[^\s]+)?/gi, '');

    // Replace Conventional Commit prefix
    trimmed = trimmed.replace(/^-?\s*(feat|fix|perf|refactor|chore|style|docs|build)(?:\([^\)]+\))?:\s*/i, (match, type) => {
      const t = type.toLowerCase();
      if (t === 'feat') return '- ✨ **Nouveauté** : ';
      if (t === 'fix') return '- 🛠️ **Correction** : ';
      if (t === 'perf') return '- ⚡ **Performance** : ';
      if (t === 'style') return '- 🎨 **Interface** : ';
      return '- 🔹 ';
    });

    // Check if line is a category title (e.g. ends with `:` or is bolded category header, even if prefixed with a bullet)
    const isAlreadyHeader = trimmed.startsWith('#');
    const endsWithColon = trimmed.endsWith(':') || trimmed.endsWith(' :');
    const isCategoryTitle = !isAlreadyHeader && endsWithColon && !isSubLevel;

    if (isCategoryTitle) {
      // Remove leading bullet if any (e.g. "• Nettoyage :" or "- Nettoyage :")
      const cleanTitle = trimmed.replace(/^[•\-\*]\s+/, '').replace(/\s*:$/, '');
      // Format as Markdown Level 4 Subheading
      filteredLines.push(`\n#### 📌 ${fixFrenchFormatting(cleanTitle)}`);
      continue;
    }

    // Standard Bullet Point formatting
    if (/^[•\-\*]\s+/.test(trimmed)) {
      const itemContent = trimmed.replace(/^[•\-\*]\s+/, '');
      const prefix = isSubLevel ? '    - ' : '- ';
      filteredLines.push(`${prefix}${fixFrenchFormatting(itemContent)}`);
    } else if (isAlreadyHeader) {
      filteredLines.push(fixFrenchFormatting(trimmed));
    } else {
      // Regular text or paragraph
      const prefix = isSubLevel ? '    ' : '';
      filteredLines.push(`${prefix}${fixFrenchFormatting(trimmed)}`);
    }
  }

  const result = filteredLines.join('\n').trim();
  if (!result) {
    return `### 🛠️ Ce qui a été fait
- Améliorations générales de l'interface, stabilité et optimisations.`;
  }

  return result;
}

export function ChangelogViewer({ content }: ChangelogViewerProps) {
  const formattedContent = cleanReleaseNotes(content);

  return (
    <div className="text-xs text-zinc-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
      <Markdown
        components={{
          h3: ({ children }) => (
            <h3 className="text-sm font-black text-amber-400 mt-2 mb-2 pb-1 border-b border-amber-500/20 flex items-center gap-1.5 tracking-tight">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-bold text-amber-300/90 mt-3 mb-1.5 pl-0.5 tracking-tight flex items-center gap-1">
              {children}
            </h4>
          ),
          ul: ({ children, depth }: any) => {
            const isNested = depth > 0;
            return (
              <ul className={cn(
                "space-y-1.5 my-1.5",
                isNested ? "pl-4 border-l border-zinc-700/60 ml-2 py-0.5" : "pl-1"
              )}>
                {children}
              </ul>
            );
          },
          li: ({ children }: any) => (
            <li className="text-zinc-300 list-disc ml-3 text-xs leading-relaxed marker:text-amber-400/80">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="text-white font-bold">{children}</strong>
          ),
          p: ({ children }) => (
            <p className="my-1.5 leading-relaxed text-zinc-300">{children}</p>
          )
        }}
      >
        {formattedContent}
      </Markdown>
    </div>
  );
}
