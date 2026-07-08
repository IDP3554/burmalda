"""
Прямая проверка _orient_head_right(): строим маску рыбки (тело+хвост)
напрямую через cv2, без сквозного пайплайна поиска контура на фото (это
покрыто другими тестами) — здесь проверяем именно логику "где голова".
"""
import math
import numpy as np
import cv2
from PIL import Image

import image_processing as ip


def make_mask(head_dir_deg, size=400):
    """Тело — залитый эллипс, хвост — узкий треугольник с противоположной
    стороны, голова смотрит в head_dir_deg (0 = вправо, по часовой)."""
    mask = np.zeros((size, size), np.uint8)
    cx, cy = size // 2, size // 2
    bw, bh = 70, 55
    rad = math.radians(head_dir_deg)

    cv2.ellipse(mask, (cx, cy), (bw, bh), math.degrees(rad), 0, 360, 1, -1)

    trad = math.radians(head_dir_deg + 180)
    perp = math.radians(head_dir_deg + 90)
    base_x = cx + math.cos(trad) * bw * 0.9
    base_y = cy + math.sin(trad) * bh * 0.9
    tip_x = cx + math.cos(trad) * (bw * 0.9 + 70)
    tip_y = cy + math.sin(trad) * (bh * 0.9 + 70)
    px, py = math.cos(perp) * 18, math.sin(perp) * 18
    pts = np.array([
        [base_x + px, base_y + py],
        [base_x - px, base_y - py],
        [tip_x, tip_y],
    ], dtype=np.int32)
    cv2.fillPoly(mask, [pts], 1)

    return mask


def head_side_of(rgba):
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        return "empty", 0, 0
    x0, x1 = xs.min(), xs.max()
    cx = xs.mean()
    d0, d1 = cx - x0, x1 - cx
    if min(d0, d1) <= 0:
        return "unclear", d0, d1
    ratio = max(d0, d1) / min(d0, d1)
    if ratio < 1.12:
        return "unclear", d0, d1
    return ("right" if d1 < d0 else "left"), d0, d1


CASES = {
    "0deg (already right)": 0,
    "45deg": 45,
    "90deg (down)": 90,
    "135deg": 135,
    "180deg (left)": 180,
    "220deg": 220,
    "270deg (up)": 270,
    "300deg": 300,
}

if __name__ == "__main__":
    print(f"{'case':<24}{'head_after':<12}{'d0':>7}{'d1':>7}  verdict")
    print("-" * 60)
    all_ok = True
    for name, deg in CASES.items():
        mask = make_mask(deg)
        # BGR-заглушка (цвет неважен для этой проверки)
        bgr = np.full((mask.shape[0], mask.shape[1], 3), 200, np.uint8)
        b, g, r = cv2.split(bgr)
        alpha = (mask * 255).astype("uint8")
        rgba = cv2.merge([r, g, b, alpha])

        out = ip._orient_head_right(rgba, mask)
        Image.fromarray(out, "RGBA").save(f"orient2_{deg}deg.png")

        side, d0, d1 = head_side_of(out)
        ok = side == "right"
        all_ok &= ok
        verdict = "OK" if ok else f"FAIL ({side})"
        print(f"{name:<24}{side:<12}{d0:7.1f}{d1:7.1f}  {verdict}")
    print()
    print("ВСЕ ПРОШЛИ" if all_ok else "ЕСТЬ ПРОВАЛЫ")
