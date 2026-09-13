#!/bin/bash
# Качва текущото състояние в GitHub. Ползва се така:
#   ./scripts/publish.sh              — записва с обща бележка
#   ./scripts/publish.sh "нещо ново"  — записва със своя бележка
set -e
cd "$(dirname "$0")/.."

if [ -z "$(git status --porcelain)" ]; then
  echo "Няма нови промени за качване."
else
  git add -A
  git commit -q -m "${1:-Обновяване на приложението}"
  echo "Записано: ${1:-Обновяване на приложението}"
fi

if ! git remote get-url origin > /dev/null 2>&1; then
  echo
  echo "Хранилището още не е свързано с GitHub. Изпълни веднъж:"
  echo "  git remote add origin https://github.com/IvanPetrovIgnatov1984/obrazec19.git"
  exit 1
fi

git push -u origin main
echo
echo "Готово. След около минута новата версия е на:"
echo "  https://ivanpetrovignatov1984.github.io/obrazec19/"
