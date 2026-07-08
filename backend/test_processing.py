from PIL import Image, ImageDraw
import io

img = Image.new('RGB', (900, 700), (90, 90, 95))
draw = ImageDraw.Draw(img)
draw.rectangle([100, 80, 800, 620], fill=(250, 250, 245))
draw.ellipse([300, 250, 600, 450], fill=(255, 140, 20))
draw.polygon([(300,350),(220,300),(220,400)], fill=(255,140,20))
buf = io.BytesIO()
img.save(buf, format='JPEG')
photo_bytes = buf.getvalue()

canvas = Image.new('RGBA', (400,400), (0,0,0,0))
d2 = ImageDraw.Draw(canvas)
d2.ellipse([100,120,300,280], fill=(30,144,255,255))
buf2 = io.BytesIO()
canvas.save(buf2, format='PNG')
canvas_bytes = buf2.getvalue()

from image_processing import process_fish_image

r1 = process_fish_image(photo_bytes, mode='photo')
print('PHOTO mode ->', r1['width'], r1['height'], 'avg_color=', r1['avg_color'], 'bytes=', len(r1['png_bytes']))

r2 = process_fish_image(canvas_bytes, mode='canvas')
print('CANVAS mode ->', r2['width'], r2['height'], 'avg_color=', r2['avg_color'], 'bytes=', len(r2['png_bytes']))

open('test_photo_result.png','wb').write(r1['png_bytes'])
open('test_canvas_result.png','wb').write(r2['png_bytes'])
print('OK saved test results')
