#!/usr/bin/env bash
# Запуск бэкенда одной командой из корня репозитория: ./start.sh
# Делает то же самое, что вручную: cd backend && (активация venv, если есть)
# && uvicorn main:app --host 0.0.0.0 --port 3000.
#
# Порт 3000 — не случаен: именно его по умолчанию ждёт поле адреса сервера
# на экране Сканера (см. index.html), так что с этим портом ничего не нужно
# донастраивать руками.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

HAD_VENV=0
if [ -d ".venv" ]; then
  HAD_VENV=1
  if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
  elif [ -f ".venv/Scripts/activate" ]; then
    source .venv/Scripts/activate
  fi
fi

if ! command -v uvicorn >/dev/null 2>&1; then
  if [ "$HAD_VENV" = "0" ]; then
    echo "venv не найден. Создайте его и поставьте зависимости (один раз):"
    echo "  python -m venv backend/.venv"
    echo "  source backend/.venv/bin/activate"
    echo "  pip install -r backend/requirements.txt"
  else
    echo "backend/.venv найден, но uvicorn в нём не установлен (зависимости не"
    echo "ставились или venv битый). Выполните:"
    echo "  source backend/.venv/bin/activate"
    echo "  pip install -r backend/requirements.txt"
  fi
  echo "(Можно и без venv, глобально: cd backend && pip install -r requirements.txt)"
  exit 1
fi

echo "Бэкенд стартует на http://0.0.0.0:3000 — узнайте IP этой машины в локальной сети"
echo "(ip addr / ifconfig), чтобы подключить Сканер с телефона: http://<этот-IP>:3000/api/fish"
exec uvicorn main:app --host 0.0.0.0 --port 3000
