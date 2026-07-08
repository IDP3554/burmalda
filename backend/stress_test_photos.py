"""
Генерирует несколько "злых" синтетических фото листа с рыбкой,
имитирующих реальные условия съёмки на хакатоне, и прогоняет их
через image_processing.process_fish_image(mode='photo').

Кейсы:
  1. uneven_light   - неровный свет (градиент по кадру, как от окна сбоку)
  2. hand_shadow    - тень от руки/головы на части листа
  3. flash_glare    - блик от вспышки (яркое пятно на бумаге)
  4. tilted         - лист сфотографирован под углом (перспектива)
  5. edge_bleed     - рисунок вылезает почти до края листа
"""
import io
import random
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

from image_processing import process_fish_image

random.seed(0)


def base_scene(w=1000, h=780, paper_box=(120, 90, 880, 690)):
    img = Image.new('RGB', (w, h), (70, 68, 72))  # тёмный стол
    draw = ImageDraw.Draw(img)
    draw.rectangle(paper_box, fill=(248, 247, 240))  # лист бумаги (чуть тёплый белый)
    return img, draw, paper_box


def draw_fish(draw, cx, cy, w, h, fill):
    draw.ellipse([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], fill=fill, outline=(20, 20, 20), width=4)
    draw.polygon([(cx - w / 2, cy), (cx - w / 2 - 60, cy - 50), (cx - w / 2 - 60, cy + 50)],
                 fill=fill, outline=(20, 20, 20))


def case_uneven_light():
    img, draw, box = base_scene()
    draw_fish(draw, 500, 390, 420, 260, (255, 120, 30))
    # градиент яркости слева направо, как свет из окна
    grad = Image.new('L', img.size)
    gdata = np.tile(np.linspace(60, 255, img.size[0]).astype('uint8'), (img.size[1], 1))
    grad.putdata(gdata.flatten())
    grad = grad.convert('RGB')
    img = Image.blend(img, grad, alpha=0.28)
    return img


def case_hand_shadow():
    img, draw, box = base_scene()
    draw_fish(draw, 500, 390, 420, 260, (60, 160, 255))
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([680, 80, 950, 400], fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    img = Image.alpha_composite(img.convert('RGBA'), shadow).convert('RGB')
    return img


def case_flash_glare():
    img, draw, box = base_scene()
    draw_fish(draw, 500, 390, 420, 260, (255, 210, 20))
    glare = Image.new('RGBA', img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glare)
    gd.ellipse([380, 260, 620, 460], fill=(255, 255, 255, 200))
    glare = glare.filter(ImageFilter.GaussianBlur(40))
    img = Image.alpha_composite(img.convert('RGBA'), glare).convert('RGB')
    return img


def case_tilted():
    img = Image.new('RGB', (1100, 850), (65, 65, 70))
    draw = ImageDraw.Draw(img)
    quad = [(180, 620), (240, 90), (980, 40), (900, 760)]
    draw.polygon(quad, fill=(248, 247, 240))
    draw_fish(draw, 560, 380, 380, 240, (200, 60, 200))
    return img


def case_edge_bleed():
    img, draw, box = base_scene()
    # рыбка почти во весь лист, хвост выходит к самому краю
    draw_fish(draw, 500, 390, 700, 520, (40, 200, 120))
    return img


CASES = {
    'uneven_light': case_uneven_light,
    'hand_shadow': case_hand_shadow,
    'flash_glare': case_flash_glare,
    'tilted': case_tilted,
    'edge_bleed': case_edge_bleed,
}

if __name__ == '__main__':
    results = []
    for name, gen in CASES.items():
        img = gen()
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=90)
        raw = buf.getvalue()
        img.save(f'stress_{name}_input.jpg')

        try:
            result = process_fish_image(raw, mode='photo')
            open(f'stress_{name}_output.png', 'wb').write(result['png_bytes'])
            out = Image.open(io.BytesIO(result['png_bytes']))
            alpha = np.array(out)[:, :, 3]
            nonzero_ratio = (alpha > 10).mean()
            status = 'OK'
            detail = (f"size={result['width']}x{result['height']} "
                      f"avg_color={result['avg_color']} fish_area={nonzero_ratio:.1%}")
            if nonzero_ratio < 0.03:
                status = 'SUSPICIOUS (почти пустая маска)'
            elif nonzero_ratio > 0.85:
                status = 'SUSPICIOUS (маска = почти весь кадр, фон не отрезан)'
        except Exception as e:
            status = 'FAIL'
            detail = f'{type(e).__name__}: {e}'

        results.append((name, status, detail))

    print(f"{'case':<15} {'status':<40} detail")
    print('-' * 100)
    for name, status, detail in results:
        print(f"{name:<15} {status:<40} {detail}")
