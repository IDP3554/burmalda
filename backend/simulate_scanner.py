"""
Эмулятор Сканера — нужен ТОЛЬКО чтобы тестировать/демонстрировать свою
часть (backend, 2-3) без реального устройства.

Отправляет запрос строго по API_CONTRACT.md: POST /api/fish, JSON,
картинка в base64 data URL.

Использование:
    python3 simulate_scanner.py путь_к_фото.jpg --mode scan --fish-type clownfish
    python3 simulate_scanner.py путь_к_рисунка.png --mode draw --fish-type whale
    python3 simulate_scanner.py фото.jpg --server http://192.168.1.50:8000
"""
import argparse
import base64
import datetime
import mimetypes
import sys

import requests


def main():
    parser = argparse.ArgumentParser(description="Эмулятор Сканера (по API_CONTRACT.md)")
    parser.add_argument("image", help="путь к файлу картинки (jpg/png)")
    parser.add_argument("--server", default="http://127.0.0.1:8000", help="адрес сервера")
    parser.add_argument("--mode", default="scan", choices=["draw", "scan"])
    parser.add_argument("--fish-type", default="clownfish",
                         choices=["clownfish", "shark", "octopus", "whale",
                                  "squid", "crab", "dolphin", "turtle", "fish"])
    args = parser.parse_args()

    url = f"{args.server}/api/fish"

    mime, _ = mimetypes.guess_type(args.image)
    mime = mime or "image/jpeg"

    try:
        with open(args.image, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        print(f"Файл не найден: {args.image}")
        sys.exit(1)

    b64 = base64.b64encode(raw).decode()
    data_url = f"data:{mime};base64,{b64}"

    payload = {
        "fishType": args.fish_type,
        "mode": args.mode,
        "image": data_url,
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    try:
        resp = requests.post(url, json=payload, timeout=15)
    except requests.exceptions.ConnectionError:
        print(f"Не удалось подключиться к серверу {args.server}. Сервер запущен?")
        sys.exit(1)

    print("Статус:", resp.status_code)
    print("Ответ:", resp.json())


if __name__ == "__main__":
    main()
