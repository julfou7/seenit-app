#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/julfou7/seenit-app.git"
BRANCH="main"

echo "=== [SeenIt Git Sync] Démarrage de la synchronisation avec GitHub ==="

# 1. Vérifier si le répertoire .git existe
if [ ! -d ".git" ]; then
  echo "⚠️ Dossier .git non trouvé. Réinitialisation et attachement au dépôt distant..."
  git init -b "$BRANCH"
  git config user.name "Julian Fouillade"
  git config user.email "JulianFouillade@gmail.com"
  git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
  git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || true
else
  # Vérifier ou corriger le remote origin si nécessaire
  CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
  if [ -z "$CURRENT_REMOTE" ]; then
    echo "⚠️ Remote origin absent. Configuration vers $REPO_URL..."
    git remote add origin "$REPO_URL"
  fi
  # 2. Exécuter git pull
  echo "📥 Récupération des dernières modifications depuis origin/$BRANCH..."
  git pull origin "$BRANCH"
fi

# 3. Afficher le dernier commit
echo "✅ Synchronisation terminée avec succès !"
echo "📌 Dernier commit local :"
git log -n 1 --format="commit %h - %s (%cr) [%an]"
