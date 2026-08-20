import React from 'react';
import Markdown from 'react-markdown';

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

  // Pre-process inline bullets "• **" or "• " into newlines so each item gets its own line
  text = text.replace(/([^\n])\s*[•\*]\s*/g, '$1\n- ');

  const lines = text.split('\n');
  const filteredLines: string[] = [];

  for (const line of lines) {
    let trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('**Full Changelog**') ||
      trimmed.startsWith('Full Changelog:') ||
      trimmed.startsWith('https://github.com/')
    ) {
      continue;
    }

    // Replace leading '• ' or '* '
    if (/^[•\*]\s+/.test(trimmed)) {
      trimmed = trimmed.replace(/^[•\*]\s+/, '- ');
    }

    // Clean commit logs like "* feat(splash): ... by @username in https://..."
    let cleanedLine = trimmed
      .replace(/\s+by\s+@[\w-]+(?:\s+in\s+https?:\/\/[^\s]+)?/gi, '')
      .replace(/^-?\s*(feat|fix|perf|refactor|chore|style|docs|build)(?:\([^\)]+\))?:\s*/i, (match, type) => {
        const t = type.toLowerCase();
        if (t === 'feat') return '- ✨ **Nouveauté** : ';
        if (t === 'fix') return '- 🛠️ **Correction** : ';
        if (t === 'perf') return '- ⚡ **Performance** : ';
        if (t === 'style') return '- 🎨 **Interface** : ';
        return '- 🔹 ';
      });

    // Ensure line starts with '- ' if it's not a header
    if (!cleanedLine.startsWith('#') && !cleanedLine.startsWith('-')) {
      cleanedLine = '- ' + cleanedLine;
    }

    // Apply french formatting (accents & apostrophes)
    cleanedLine = fixFrenchFormatting(cleanedLine);

    filteredLines.push(cleanedLine);
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
    <div className="text-xs text-zinc-300 space-y-2 leading-relaxed [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-amber-300 [&_h3]:mt-1 [&_h3]:mb-2.5 [&_h4]:text-xs [&_h4]:font-bold [&_h4]:text-amber-400 [&_ul]:space-y-2.5 [&_ul]:my-2 [&_li]:list-disc [&_li]:ml-4 [&_li]:pl-1 [&_strong]:text-white [&_strong]:font-bold [&_p]:my-1.5">
      <Markdown>{formattedContent}</Markdown>
    </div>
  );
}
