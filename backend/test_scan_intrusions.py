"""
Синтетическая проверка вырезания рыбки при помехах: рука держит лист с краю,
ручка лежит поперёк, лист на тёмном столе. Ожидаем, что в результат попадёт
ТОЛЬКО рыбка (компактная цветная фигура по центру), без руки/ручки/фона.
"""
import io
import numpy as np
from PIL import Image, ImageDraw
import cv2

from image_processing import process_fish_image


def scene(with_hand=True, with_pen=True, fish_fill=(255, 140, 20)):
    W, H = 1100, 850
    img = Image.new("RGB", (W, H), (70, 68, 72))  # тёмный стол
    d = ImageDraw.Draw(img)
    d.rectangle([120, 90, 980, 760], fill=(248, 247, 240))  # лист

    # печатная рыбка по центру: тёмный контур + цветная заливка
    cx, cy = 560, 420
    d.ellipse([cx - 210, cy - 130, cx + 210, cy + 130], fill=fish_fill, outline=(25, 25, 25), width=6)
    d.polygon([(cx - 210, cy), (cx - 300, cy - 70), (cx - 300, cy + 70)],
              fill=fish_fill, outline=(25, 25, 25))
    d.ellipse([cx - 150, cy - 60, cx - 110, cy - 20], fill=(20, 20, 20))  # глаз

    if with_hand:  # рука-«телесное» пятно заходит снизу за край листа
        d.ellipse([700, 640, 1050, 980], fill=(215, 165, 140))
        for fx in (760, 830, 900, 970):
            d.ellipse([fx, 560, fx + 55, 700], fill=(215, 165, 140))

    if with_pen:  # тонкая тёмная ручка лежит наискосок в углу
        d.line([(150, 720), (430, 560)], fill=(15, 15, 40), width=14)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def analyze(png_bytes):
    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    arr = np.array(im)
    alpha = arr[:, :, 3]
    m = alpha > 10
    ratio = m.sum() / alpha.size
    if m.sum() == 0:
        return ratio, None, 0.0, 0.0
    rgb = arr[:, :, :3][m].astype(int)
    avg = rgb.mean(axis=0).astype(int).tolist()
    # доля "телесных" пикселей (рука) и "почти чёрных чернил ручки" в вырезанном
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    skin = ((r > 180) & (g > 120) & (g < 200) & (b > 90) & (b < 180) & (r > b)).mean()
    penlike = ((r < 60) & (g < 60) & (b < 90)).mean()
    return ratio, avg, skin, penlike


CASES = {
    "fish_only":        dict(with_hand=False, with_pen=False),
    "fish+pen":         dict(with_hand=False, with_pen=True),
    "fish+hand":        dict(with_hand=True,  with_pen=False),
    "fish+hand+pen":    dict(with_hand=True,  with_pen=True),
}

if __name__ == "__main__":
    print(f"{'case':<16}{'fill%':>7}{'skin%':>8}{'pen%':>7}  avg_color   verdict")
    print("-" * 70)
    for name, kw in CASES.items():
        raw = scene(**kw)
        Image.open(io.BytesIO(raw)).save(f"scan_{name}_input.jpg")
        try:
            res = process_fish_image(raw, mode="photo")
            open(f"scan_{name}_output.png", "wb").write(res["png_bytes"])
            ratio, avg, skin, pen = analyze(res["png_bytes"])
            # рыбка компактная (~35% кадра) и оранжевая (r заметно больше b).
            # Плохо = вырезано слишком много (захватили руку) ИЛИ цвет уже не
            # оранжевый (значит доминирует посторонний объект/кожа).
            orange = avg is not None and (avg[0] - avg[2]) > 40
            bad = ratio > 0.50 or skin > 0.15 or not orange
            verdict = "ПЛОХО (помеха в кадре)" if bad else "ok (только рыбка)"
            print(f"{name:<16}{ratio*100:6.1f}{skin*100:8.1f}{pen*100:7.1f}  {str(avg):<11} {verdict}")
        except Exception as e:
            print(f"{name:<16}  FAIL: {type(e).__name__}: {e}")
