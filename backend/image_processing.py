import io
import numpy as np
import cv2
from PIL import Image, ImageOps

TARGET_SIZE = 512  # итоговый холст для спрайта Стены (квадрат, прозрачный фон)


def process_fish_image(raw_bytes: bytes, mode: str = "photo") -> dict:
    """
    Возвращает dict:
      png_bytes -- PNG (RGBA) с рыбкой на прозрачном фоне
      avg_color -- средний цвет рыбки [r,g,b] (для доп. эффектов в клиенте
                   Стены, например подсветки/частиц вокруг рыбки)
      width, height -- итоговые размеры (всегда TARGET_SIZE x TARGET_SIZE)
    """
    if mode == "canvas":
        return _process_canvas(raw_bytes)
    return _process_photo(raw_bytes)


def _process_canvas(raw_bytes: bytes) -> dict:
    """Рыбка уже нарисована в вебе на canvas -> просто нормализуем + считаем цвет."""
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    img = _resize_contain(img, TARGET_SIZE)
    return _finalize(img)


def _process_photo(raw_bytes: bytes) -> dict:
    """
    Фото рыбки на бумаге: на листе заранее напечатан контур рыбки, ребёнок
    его раскрасил. Нужно вырезать ТОЛЬКО рыбку и убрать всё лишнее —
    лист, стол, руку, которой держат лист, ручку/карандаш рядом и т.п.

    Этапы:
      1. Находим сам лист бумаги (quad-документ) и выпрямляем перспективу —
         убираем стол и перекос камеры.
      2. Внутри листа собираем "рисованные" пиксели (цветная заливка + тёмный
         контур), затем из всех найденных фигур выбираем именно рыбку:
         крупную, ближе к центру листа, сплошную/выпуклую замкнутую фигуру.
         Рука/ручка обычно заходят с краю кадра, они несплошные и/или сбоку —
         такие кандидаты отсеиваются по этому же скорингу.
      3. Заливаем выбранный контур целиком (внутренности рыбки сохраняются),
         обрезаем и вписываем в 512×512 с прозрачным фоном.
    """
    # Телефонные фото часто несут EXIF-тег ориентации (поворот на 90/180/270 —
    # это метаданные, а не поворот самих пикселей). cv2.imdecode эти метаданные
    # полностью игнорирует, так что без явной коррекции здесь фото может быть
    # буквально повёрнуто боком ещё до начала поиска листа. Правим через PIL
    # (умеет читать EXIF), затем конвертируем в OpenCV BGR для остального
    # пайплайна.
    try:
        pil_img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw_bytes)))
    except Exception as e:
        raise ValueError(f"cannot decode image: {e}")
    img_bgr = cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)

    paper = _extract_paper(img_bgr)  # BGR, только сам лист (без стола)

    mask = _select_fish_mask(paper)  # умный выбор рыбки среди всех фигур
    if mask is None or mask.sum() == 0:
        # запасной путь — старое поведение "самое большое пятно"
        mask = _fallback_biggest_blob(paper)
    if mask is None or mask.sum() == 0:
        raise ValueError("fish drawing not found on paper")

    return _cutout_from_mask(paper, mask)


def _select_fish_mask(paper_bgr: np.ndarray):
    """Находит рыбку по её напечатанному тёмному контуру и возвращает залитую
    0/1 маску. Ключевая идея: на листе-раскраске рыбка обведена замкнутой тёмной
    линией, внутри которой ребёнок раскрашивает. Рука не тёмная — в кандидаты не
    попадает вовсе; ручка/карандаш тонкие — отсекаются по площади; край листа —
    по прилипанию ко всем сторонам кадра. Скоринг выбирает крупную, центральную,
    сплошную замкнутую фигуру. None — если подходящего контура нет."""
    h, w = paper_bgr.shape[:2]
    gray = cv2.cvtColor(paper_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    # тёмные линии — адаптивный порог устойчив к неровному свету/теням.
    # Замыкаем разрывы, чтобы печатный контур рыбки стал цельным кольцом.
    ink = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 10)
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)

    contours, _ = cv2.findContours(ink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    cx, cy = w / 2.0, h / 2.0
    diag = (w * w + h * h) ** 0.5
    frame_area = float(w * h)

    best, best_score = None, -1.0
    for c in contours:
        area = cv2.contourArea(c)            # площадь, ЗАМКНУТАЯ контуром (= размер рыбки)
        if area < 0.02 * frame_area:         # мелочь: ручка, точки, шум
            continue
        if area > 0.92 * frame_area:         # это рамка/край листа, а не рыбка
            continue
        m = cv2.moments(c)
        if m["m00"] == 0:
            continue
        ccx, ccy = m["m10"] / m["m00"], m["m01"] / m["m00"]
        center_dist = (((ccx - cx) ** 2 + (ccy - cy) ** 2) ** 0.5) / diag  # 0..~0.7

        hull_area = cv2.contourArea(cv2.convexHull(c))
        solidity = area / hull_area if hull_area > 0 else 0.0  # рыбка выпуклая

        x, y, bw, bh = cv2.boundingRect(c)
        touches = (x <= 1) + (y <= 1) + (x + bw >= w - 1) + (y + bh >= h - 1)

        # крупная + по центру + сплошная + не липнет к нескольким краям
        score = area * (1.0 - center_dist) * (0.4 + 0.6 * solidity) * (1.0 - 0.2 * touches)
        if score > best_score:
            best_score, best = score, c

    if best is None:
        return None

    mask = np.zeros((h, w), np.uint8)
    cv2.drawContours(mask, [best], -1, 1, thickness=cv2.FILLED)  # заливка сохраняет нутро рыбки
    return mask


def _fallback_biggest_blob(paper_bgr: np.ndarray):
    """Запасной путь (старое поведение): самое большое цветное/тёмное пятно."""
    fish_mask = _extract_drawing_mask(paper_bgr)
    contours, _ = cv2.findContours(fish_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    mask = np.zeros_like(fish_mask)
    cv2.drawContours(mask, [biggest], -1, 1, thickness=cv2.FILLED)
    return mask


def _cutout_from_mask(paper_bgr: np.ndarray, mask: np.ndarray) -> dict:
    """По 0/1 маске вырезает рыбку из листа: RGBA с прозрачным фоном, обрезка,
    вписывание в 512×512."""
    b, g, r = cv2.split(paper_bgr)
    alpha = (mask * 255).astype("uint8")
    rgba = cv2.merge([r, g, b, alpha])

    ys, xs = np.where(mask > 0)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    cropped = rgba[y0:y1 + 1, x0:x1 + 1]

    pil_img = Image.fromarray(cropped, mode="RGBA")
    pil_img = _resize_contain(pil_img, TARGET_SIZE)
    return _finalize(pil_img)


def _extract_paper(img_bgr: np.ndarray) -> np.ndarray:
    """Находит лист бумаги в кадре (по контуру-четырёхугольнику) и выпрямляет его.
    Если четырёхугольник не найден — возвращает исходное изображение (fallback)."""
    h, w = img_bgr.shape[:2]
    scale = 800 / max(h, w)
    small = cv2.resize(img_bgr, (int(w * scale), int(h * scale)))

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

    quad = None
    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.contourArea(approx) > 0.15 * small.shape[0] * small.shape[1]:
            quad = approx.reshape(4, 2).astype("float32")
            break

    if quad is None:
        return img_bgr  # fallback: не нашли лист — работаем со всем кадром

    quad = quad / scale  # обратно в координаты оригинала
    rect = _order_points(quad)
    (tl, tr, br, bl) = rect

    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = int(max(width_a, width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = int(max(height_a, height_b))

    if max_width < 20 or max_height < 20:
        return img_bgr

    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1]], dtype="float32")

    m = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img_bgr, m, (max_width, max_height))
    return warped


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Упорядочивает 4 точки: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _extract_drawing_mask(paper_bgr: np.ndarray) -> np.ndarray:
    """Внутри листа находит сам рисунок: цветную заливку (высокая насыщенность)
    и/или тёмный печатный контур (низкая яркость). Белый фон листа отсеивается."""
    hsv = cv2.cvtColor(paper_bgr, cv2.COLOR_BGR2HSV)
    s_channel = hsv[:, :, 1]
    v_channel = hsv[:, :, 2]

    colored = s_channel > 40        # заметно окрашенные пиксели
    dark_ink = v_channel < 120      # тёмные линии контура/карандаш

    mask = (colored | dark_ink).astype("uint8")

    kernel = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    # не даём краю листа (тень/сгиб) ложно попасть в маску
    border = int(min(paper_bgr.shape[:2]) * 0.03)
    if border > 0:
        mask[:border, :] = 0
        mask[-border:, :] = 0
        mask[:, :border] = 0
        mask[:, -border:] = 0

    return mask


def _resize_contain(img: Image.Image, target: int) -> Image.Image:
    """Вписываем рыбку в target x target холст, сохраняя пропорции, фон прозрачный."""
    img = img.copy()
    img.thumbnail((target, target), Image.LANCZOS)
    canvas = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    offset = ((target - img.width) // 2, (target - img.height) // 2)
    canvas.paste(img, offset, img)
    return canvas


def _finalize(img: Image.Image) -> dict:
    arr = np.array(img)
    alpha = arr[:, :, 3]
    mask = alpha > 10
    if mask.sum() == 0:
        avg_color = [255, 255, 255]
    else:
        avg_color = arr[:, :, :3][mask].mean(axis=0).astype(int).tolist()

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {
        "png_bytes": buf.getvalue(),
        "avg_color": avg_color,
        "width": img.width,
        "height": img.height,
    }
