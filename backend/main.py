import base64
import json
import time
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from image_processing import process_fish_image

APP_DIR = Path(__file__).parent
STORAGE_DIR = APP_DIR / "storage"
STORAGE_DIR.mkdir(exist_ok=True)

# Статика (Сканер + Аквариум) лежит в корне репозитория, на уровень выше backend/.
SITE_DIR = APP_DIR.parent

app = FastAPI(title="Animagia Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["Content-Type"],
)

# In-memory состояние — этого достаточно для хакатона (демо в одной сессии)
fish_queue: List[dict] = []          # история рыб (для поллинга/реконнекта)

# Активные подключения "Стены"/сайта, куда рыбки транслируются (может быть несколько)
wall_connections: List[WebSocket] = []


class FishPayload(BaseModel):
    fishType: str
    mode: str                 # "draw" (раскраска на экране) | "scan" (фото с камеры)
    image: str                # data URL: "data:image/png;base64,...."
    createdAt: Optional[str] = None


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": time.time(), "queue_len": len(fish_queue)}


# --- Отдача статики: чтобы Сканер и Аквариум открывались с того же адреса, что и
# API (нужно для деплоя на Railway/хостинг, где всё живёт на одном порту). ---
# Cache-Control: no-cache (не no-store) — браузер всё равно кэширует файл, но
# обязан проверить актуальность на сервере (If-None-Match/ETag) перед каждым
# использованием, а не грузить заново с нуля. FileResponse сам выставляет
# ETag/Last-Modified по mtime+size, так что revalidation работает "из коробки"
# — этого достаточно, чтобы обычный Refresh (не Ctrl+Shift+R) подхватывал
# новую версию сразу после правки файла и перезапуска бэкенда.
STATIC_HEADERS = {"Cache-Control": "no-cache"}


@app.get("/")
async def site_index():
    return FileResponse(SITE_DIR / "index.html", headers=STATIC_HEADERS)


@app.get("/app.js")
async def site_appjs():
    return FileResponse(SITE_DIR / "app.js", media_type="application/javascript",
                         headers=STATIC_HEADERS)


@app.get("/aquarium.html")
async def site_aquarium():
    return FileResponse(SITE_DIR / "aquarium.html", headers=STATIC_HEADERS)


@app.post("/api/fish")
async def receive_fish(payload: FishPayload):
    """
    Эндпоинт по контракту со Сканером (см. API_CONTRACT.md):
    mode=draw -> рыбка нарисована на экране, фон обычно уже чистый
    mode=scan -> фото с камеры, по контракту сканер уже обрезает по контуру
                 рисунка, но лист/бумага внутри кадра ещё могут быть видны —
                 здесь всё равно убираем их до чистой рыбки с прозрачным фоном
    """
    try:
        raw = _decode_data_url(payload.image)
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": f"bad_image_data: {e}"})

    proc_mode = "canvas" if payload.mode == "draw" else "photo"

    try:
        result = process_fish_image(raw, mode=proc_mode)
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": f"processing_failed: {e}"})

    fish_id = str(uuid.uuid4())[:8]
    out_path = STORAGE_DIR / f"{fish_id}.png"
    out_path.write_bytes(result["png_bytes"])

    meta = {
        "fish_id": fish_id,
        "fishType": payload.fishType,
        "mode": payload.mode,
        "created_at": time.time(),
        "avg_color": result["avg_color"],      # [r,g,b] — можно использовать для доп. эффектов на сайте
        "width": result["width"],
        "height": result["height"],
        "image_url": f"/api/fish/{fish_id}/image",
    }
    fish_queue.append(meta)

    await broadcast_to_walls({"type": "new_fish", **meta})

    return {"ok": True, "fishType": payload.fishType, "mode": payload.mode}


def _decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("expected data URL like data:image/png;base64,....")
    _, b64_part = data_url.split(",", 1)
    return base64.b64decode(b64_part)


@app.get("/api/fish/{fish_id}/image")
async def get_fish_image(fish_id: str):
    path = STORAGE_DIR / f"{fish_id}.png"
    if not path.exists():
        return JSONResponse(status_code=404, content={"error": "not_found"})
    return FileResponse(path, media_type="image/png")


@app.get("/api/fish/queue")
async def get_queue(since: float = 0):
    """Fallback на случай проблем с WebSocket: сайт может поллить каждые 1-2 сек."""
    return [f for f in fish_queue if f["created_at"] > since]


@app.get("/api/fish/latest")
async def get_latest_fish():
    """Алиас-эндпоинт для клиентов Стены, которым удобнее один последний
    объект рыбки, а не массив (в отличие от /api/fish/queue) — используется
    HTTP-fallback поллингом в aquarium.html. Тот же формат полей, что и
    элемент /api/fish/queue / сообщение WS. Пустая история -> {} (без
    fish_id — клиент трактует это как "новой рыбки нет")."""
    return fish_queue[-1] if fish_queue else {}


@app.websocket("/ws/wall")
async def ws_wall(websocket: WebSocket):
    await websocket.accept()
    wall_connections.append(websocket)
    try:
        # при подключении сразу шлём последние N рыб (реконнект не теряет данные)
        for meta in fish_queue[-20:]:
            await websocket.send_text(json.dumps({"type": "new_fish", **meta}))
        while True:
            # держим соединение живым; можно принимать пинги/ack от клиента
            await websocket.receive_text()
    except WebSocketDisconnect:
        wall_connections.remove(websocket)


async def broadcast_to_walls(message: dict):
    dead = []
    for ws in wall_connections:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            dead.append(ws)
    for ws in dead:
        wall_connections.remove(ws)
