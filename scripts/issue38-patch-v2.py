from pathlib import Path

source_path = Path('scripts/issue38-patch.py')
source = source_path.read_text()
start = source.index('# SPEC : corriger la règle SEENIT-PLEX-006, conserver le toast.')
end = source.index('# Catalogue de tests.')
replacement = '''# SPEC : corriger la règle SEENIT-PLEX-006, conserver le toast.
p = Path('docs/specifications/seenit.md')
s = p.read_text()
general_old = "- Les actions manuelles SeenIt restent prioritaires : une synchronisation externe est additive\\n  et ne supprime pas silencieusement une progression saisie par l'utilisateur.\\n"
general_new = "- Une synchronisation externe ne déduit jamais une suppression depuis une simple absence. Une source\\n  explicitement bidirectionnelle peut toutefois appliquer un état contraire lorsqu’elle fournit une preuve\\n  autoritative ; pour Plex, seul un `viewCount=0` observé pendant un full scan vaut dé-vu.\\n"
if general_old not in s:
    raise SystemExit('Règle générale de progression introuvable')
s = s.replace(general_old, general_new, 1)
req_start = s.index('- **SEENIT-PLEX-006**')
req_end = s.index('\\n- Le full scan est paginé.', req_start)
new_requirement = "- **SEENIT-PLEX-006** — Un scan Plex complet réconcilie l’état vu **et explicitement non vu**\\n  des films et épisodes présents dans l’inventaire courant. Un `viewCount > 0` constitue une preuve vue ;\\n  un `viewCount = 0` explicitement observé retire le visionnage SeenIt correspondant. Une simple absence\\n  dans l’historique incrémental ne vaut jamais dé-vu. En présence de plusieurs copies du même média, une\\n  copie vue gagne sur une copie non vue. L’écriture Firestore applique uniquement les mutations de\\n  progression produites par le scan afin de ne pas écraser une action SeenIt concurrente non concernée."
s = s[:req_start] + new_requirement + s[req_end:]
p.write_text(s)


'''
patched_source = source[:start] + replacement + source[end:]
exec(compile(patched_source, str(source_path), 'exec'))
