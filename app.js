// ===== Устройство «Сканер» — Анимагия =====
// Два режима: (1) раскраска на экране, (2) фото раскрашенного рисунка с бумаги.
// По готовности — POST на сервер (Устройство «Стена» / бэкенд), см. serverUrl.

const state = {
  mode: null,       // 'draw' | 'scan'
  fishType: null,   // clownfish | shark | ...
  stream: null,     // camera MediaStream
  shotDataUrl: null // captured photo as data URL
};

// ---------- Живой фон-аквариум (декор) ----------
function buildOceanBackground() {
  const bg = document.getElementById('oceanBg');
  if (!bg) return;

  const FISH_EMOJIS = ['🐠', '🐟', '🐡', '🐬', '🦈', '🐙'];
  const fishCount = 6;
  for (let i = 0; i < fishCount; i++) {
    const el = document.createElement('div');
    el.className = 'bg-fish' + (Math.random() < 0.5 ? ' flip' : '');
    el.textContent = FISH_EMOJIS[Math.floor(Math.random() * FISH_EMOJIS.length)];
    el.style.top = (32 + Math.random() * 60) + 'vh';
    el.style.fontSize = (22 + Math.random() * 26) + 'px';
    el.style.setProperty('--bob', (Math.random() * 60 - 30) + 'px');
    el.style.animationDuration = (18 + Math.random() * 22) + 's';
    el.style.animationDelay = (-Math.random() * 20) + 's';
    bg.appendChild(el);
  }

  const bubbleCount = 14;
  for (let i = 0; i < bubbleCount; i++) {
    const el = document.createElement('div');
    el.className = 'bubble';
    const size = 4 + Math.random() * 14;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.setProperty('--sway', (Math.random() * 40 - 20) + 'px');
    el.style.animationDuration = (6 + Math.random() * 8) + 's';
    el.style.animationDelay = (-Math.random() * 12) + 's';
    bg.appendChild(el);
  }

  const weedPositions = [4, 18, 82, 94];
  weedPositions.forEach((leftPct, i) => {
    const el = document.createElement('div');
    el.className = 'weed';
    el.textContent = '🌿';
    el.style.left = leftPct + 'vw';
    el.style.animationDelay = (-i * 1.3) + 's';
    bg.appendChild(el);
  });
}
buildOceanBackground();

const screens = {
  home: document.getElementById('screen-home'),
  fishtype: document.getElementById('screen-fishtype'),
  color: document.getElementById('screen-color'),
  scan: document.getElementById('screen-scan'),
  status: document.getElementById('screen-status'),
  aquarium: document.getElementById('screen-aquarium'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function getServerUrl() {
  return document.getElementById('serverUrl').value.trim();
}

// Если адрес не меняли вручную, подставляем тот же origin, с которого открыт
// Сканер (бэкенд сам отдаёт эту страницу). Так работает и локально, и по
// локальной сети (http://<ip>:3000), и на хостинге — без правки кода.
(function () {
  const su = document.getElementById('serverUrl');
  if (su && location.protocol.startsWith('http') &&
      (!su.value || /localhost:3000|192\.168\.|127\.0\.0\.1/.test(su.value))) {
    su.value = location.origin + '/api/fish';
  }
})();

// ---------- Home: mode selection ----------
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    state.mode = card.dataset.mode;
    showScreen('fishtype');
  });
});

document.getElementById('toAquariumBtn').addEventListener('click', () => {
  showScreen('aquarium');
  initAquarium();
});

// ---------- Back links ----------
document.querySelectorAll('.back-link').forEach(link => {
  link.addEventListener('click', () => {
    const target = link.dataset.back;
    if (target === 'home') showScreen('home');
    if (target === 'fishtype') {
      stopCamera();
      showScreen('fishtype');
    }
  });
});

// ---------- Fish type picker ----------
const fishGrid = document.getElementById('fishGrid');
const toColoringBtn = document.getElementById('toColoringBtn');

fishGrid.addEventListener('click', (e) => {
  const opt = e.target.closest('.fish-opt');
  if (!opt) return;
  document.querySelectorAll('.fish-opt').forEach(o => o.classList.remove('selected'));
  opt.classList.add('selected');
  state.fishType = opt.dataset.fish;
  toColoringBtn.disabled = false;
});

toColoringBtn.addEventListener('click', () => {
  if (state.mode === 'draw') {
    showScreen('color');
    initCanvas();
  } else {
    showScreen('scan');
    initCamera();
  }
});

// ===================================================================
// MODE: draw on screen (canvas coloring)
// ===================================================================
const paintCanvas = document.getElementById('paintCanvas');
const ctx = paintCanvas.getContext('2d');
const COLORS = ['#e63946', '#f4a261', '#ffd166', '#06d6a0', '#118ab2', '#073b4c', '#ffffff', '#000000', '#9d4edd', '#ff6b9d'];
let currentColor = COLORS[0];
let drawing = false;

let hasActiveClip = false;

// Контур рыбки — используется и для отрисовки линии, и как область обрезки
// (clip), чтобы кисть физически не могла закрасить что-то за пределами силуэта.
// У каждого типа рыбы (state.fishType) — свой узнаваемый силуэт.

// Хвост/плавник-«вилка»: одна точка крепления к телу + один-два кончика наружу.
// Используется как общий кирпичик для хвостов, плавников, клешней, лапок и т.п.
function addFin(path, ax, ay, tips) {
  path.moveTo(ax, ay);
  tips.forEach(([tx, ty]) => path.lineTo(tx, ty));
  path.closePath();
}

const FISH_SHAPES = {
  // Обычная рыбка — базовый овал + хвост-вилка (как было изначально).
  fish: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.45, h * 0.45, w * 0.32, h * 0.2, 0, 0, Math.PI * 2);
    addFin(path, w * 0.75, h * 0.45, [[w * 0.95, h * 0.3], [w * 0.95, h * 0.6]]);
    return path;
  },

  // Рыба-клоун — округлое тело, спинной и брюшной плавники, раздвоенный хвост.
  clownfish: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.46, h * 0.45, w * 0.30, h * 0.22, 0, 0, Math.PI * 2);
    addFin(path, w * 0.73, h * 0.45, [[w * 0.94, h * 0.28], [w * 0.85, h * 0.45], [w * 0.94, h * 0.62]]);
    addFin(path, w * 0.42, h * 0.25, [[w * 0.50, h * 0.07], [w * 0.58, h * 0.27]]);
    addFin(path, w * 0.40, h * 0.65, [[w * 0.46, h * 0.83], [w * 0.54, h * 0.63]]);
    return path;
  },

  // Акула — вытянутое торпедообразное тело с острым носом, высокий спинной
  // плавник, асимметричный хвост (верхняя лопасть заметно больше нижней).
  shark: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.46, h * 0.48, w * 0.30, h * 0.14, 0, 0, Math.PI * 2);
    addFin(path, w * 0.17, h * 0.46, [[w * 0.02, h * 0.48], [w * 0.17, h * 0.55]]);
    addFin(path, w * 0.42, h * 0.35, [[w * 0.49, h * 0.05], [w * 0.57, h * 0.36]]);
    addFin(path, w * 0.73, h * 0.49, [[w * 0.97, h * 0.14], [w * 0.83, h * 0.49], [w * 0.90, h * 0.58]]);
    return path;
  },

  // Осьминог — круглая голова и «юбка» из щупалец-бугорков снизу.
  octopus: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.5, h * 0.32, w * 0.26, h * 0.22, 0, 0, Math.PI * 2);
    const legCount = 6;
    for (let i = 0; i < legCount; i++) {
      const t = i / (legCount - 1);
      const ax = w * (0.28 + t * 0.44);
      addFin(path, ax, h * 0.48, [
        [ax - w * 0.045, h * (0.78 + (i % 2 ? 0.05 : 0))],
        [ax + w * 0.045, h * 0.48],
      ]);
    }
    return path;
  },

  // Кит — очень крупное округлое тело, плоский широкий хвостовой флюк
  // (шире и площе, чем у остальных рыб), маленький грудной плавник.
  whale: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.44, h * 0.48, w * 0.38, h * 0.30, 0, 0, Math.PI * 2);
    addFin(path, w * 0.80, h * 0.50, [[w * 0.99, h * 0.40], [w * 0.90, h * 0.50], [w * 0.99, h * 0.60]]);
    addFin(path, w * 0.40, h * 0.72, [[w * 0.30, h * 0.87], [w * 0.50, h * 0.74]]);
    return path;
  },

  // Кальмар — вытянутая мантия с плавником-«стрелкой» сзади и свисающими щупальцами спереди.
  squid: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.56, h * 0.40, w * 0.26, h * 0.20, 0, 0, Math.PI * 2);
    addFin(path, w * 0.78, h * 0.40, [[w * 0.95, h * 0.28], [w * 0.78, h * 0.53]]);
    const tentacles = 4;
    for (let i = 0; i < tentacles; i++) {
      const ax = w * (0.24 + i * 0.045);
      addFin(path, ax, h * 0.54, [
        [ax - w * 0.025, h * (0.80 + i * 0.02)],
        [ax + w * 0.035, h * 0.54],
      ]);
    }
    return path;
  },

  // Краб — широкое приплюснутое тело, глаза-стебельки, две клешни, лапки по бокам.
  crab: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.5, h * 0.52, w * 0.30, h * 0.19, 0, 0, Math.PI * 2);
    path.moveTo(w * 0.40, h * 0.34);
    path.ellipse(w * 0.40, h * 0.30, w * 0.035, h * 0.045, 0, 0, Math.PI * 2);
    path.moveTo(w * 0.52, h * 0.32);
    path.ellipse(w * 0.52, h * 0.27, w * 0.035, h * 0.045, 0, 0, Math.PI * 2);
    path.moveTo(w * 0.20, h * 0.44);
    path.ellipse(w * 0.20, h * 0.44, w * 0.11, h * 0.09, -0.3, 0, Math.PI * 2);
    path.moveTo(w * 0.80, h * 0.44);
    path.ellipse(w * 0.80, h * 0.44, w * 0.11, h * 0.09, 0.3, 0, Math.PI * 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const ax = w * (0.5 + side * (0.20 + i * 0.06));
        addFin(path, ax, h * 0.66, [[ax + side * w * 0.03, h * 0.80]]);
      }
    }
    return path;
  },

  // Дельфин — обтекаемое тело с «клювом», спинной плавник, хвостовой флюк.
  dolphin: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.47, h * 0.48, w * 0.30, h * 0.16, 0, 0, Math.PI * 2);
    addFin(path, w * 0.18, h * 0.46, [[w * 0.02, h * 0.42], [w * 0.18, h * 0.54]]);
    addFin(path, w * 0.46, h * 0.32, [[w * 0.52, h * 0.12], [w * 0.58, h * 0.34]]);
    addFin(path, w * 0.75, h * 0.48, [[w * 0.96, h * 0.34], [w * 0.85, h * 0.48], [w * 0.96, h * 0.62]]);
    return path;
  },

  // Черепаха — круглый панцирь, маленькая голова, четыре ласты, хвостик.
  turtle: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.52, h * 0.48, w * 0.30, h * 0.26, 0, 0, Math.PI * 2);
    path.moveTo(w * 0.29, h * 0.46);
    path.ellipse(w * 0.20, h * 0.46, w * 0.09, h * 0.08, 0, 0, Math.PI * 2);
    path.moveTo(w * 0.32, h * 0.26);
    path.ellipse(w * 0.30, h * 0.24, w * 0.10, h * 0.06, -0.4, 0, Math.PI * 2);
    path.moveTo(w * 0.32, h * 0.70);
    path.ellipse(w * 0.30, h * 0.72, w * 0.10, h * 0.06, 0.4, 0, Math.PI * 2);
    path.moveTo(w * 0.72, h * 0.24);
    path.ellipse(w * 0.70, h * 0.22, w * 0.10, h * 0.06, 0.4, 0, Math.PI * 2);
    path.moveTo(w * 0.72, h * 0.72);
    path.ellipse(w * 0.70, h * 0.74, w * 0.10, h * 0.06, -0.4, 0, Math.PI * 2);
    addFin(path, w * 0.80, h * 0.48, [[w * 0.92, h * 0.46], [w * 0.80, h * 0.54]]);
    return path;
  },
};

function getFishPath(w, h) {
  const shape = FISH_SHAPES[state.fishType] || FISH_SHAPES.fish;
  return shape(w, h);
}

function initCanvas() {
  const wrapWidth = paintCanvas.parentElement.clientWidth;
  paintCanvas.width = wrapWidth;
  paintCanvas.height = Math.round(wrapWidth * 1.1); // сброс canvas — заодно снимает старый clip
  hasActiveClip = false;
  resetPaintCanvas();
  buildPalette();
}

function resetPaintCanvas() {
  if (hasActiveClip) {
    ctx.restore(); // снимаем предыдущий clip, иначе новый фон/контур обрежется по старой области
    hasActiveClip = false;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  drawFishOutline();

  // Обрезаем область рисования строго по контуру рыбки — красить "за линией" нельзя.
  const path = getFishPath(paintCanvas.width, paintCanvas.height);
  ctx.save();
  ctx.clip(path);
  hasActiveClip = true;
}

function drawFishOutline() {
  const w = paintCanvas.width, h = paintCanvas.height;
  const path = getFishPath(w, h);
  ctx.save();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.stroke(path);
  ctx.restore();
}

function buildPalette() {
  const palette = document.getElementById('palette');
  palette.innerHTML = '';
  COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      currentColor = c;
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
    palette.appendChild(sw);
  });
}

function getPos(e) {
  const rect = paintCanvas.getBoundingClientRect();
  const scaleX = paintCanvas.width / rect.width;
  const scaleY = paintCanvas.height / rect.height;
  const point = e.touches ? e.touches[0] : e;
  return {
    x: (point.clientX - rect.left) * scaleX,
    y: (point.clientY - rect.top) * scaleY
  };
}

function startDraw(e) {
  drawing = true;
  const p = getPos(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  e.preventDefault();
}
function moveDraw(e) {
  if (!drawing) return;
  const p = getPos(e);
  ctx.lineWidth = document.getElementById('brushSize').value;
  ctx.lineCap = 'round';
  ctx.strokeStyle = currentColor;
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  e.preventDefault();
}
function endDraw() { drawing = false; }

['mousedown', 'touchstart'].forEach(ev => paintCanvas.addEventListener(ev, startDraw, { passive: false }));
['mousemove', 'touchmove'].forEach(ev => paintCanvas.addEventListener(ev, moveDraw, { passive: false }));
['mouseup', 'mouseleave', 'touchend'].forEach(ev => paintCanvas.addEventListener(ev, endDraw));

document.getElementById('clearBtn').addEventListener('click', () => {
  resetPaintCanvas();
});

document.getElementById('sendColorBtn').addEventListener('click', () => {
  // В режиме рисования мы точно знаем геометрию контура, поэтому не нужны
  // пиксельные догадки: просто рисуем ТОЛЬКО внутренность силуэта (clip по пути).
  // Всё, что снаружи контура — остаётся прозрачным (мы туда ничего не рисуем),
  // а вся внутренность (включая незакрашенные белые места) — сохраняется целиком.
  const w = paintCanvas.width, h = paintCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  const path = getFishPath(w, h);
  octx.save();
  octx.clip(path);
  octx.drawImage(paintCanvas, 0, 0); // белый фон + краска внутри контура
  octx.restore();
  octx.strokeStyle = '#333';        // сам контур поверх — чёткая обводка края
  octx.lineWidth = 3;
  octx.stroke(path);
  sendFish(out.toDataURL('image/png'));
});

// ===================================================================
// MODE: scan real paper drawing via camera
// ===================================================================
const video = document.getElementById('video');
const shotCanvas = document.getElementById('shotCanvas');
const shutterBtn = document.getElementById('shutterBtn');
const scanPreviewBox = document.getElementById('scanPreviewBox');

async function initCamera() {
  scanPreviewBox.style.display = 'none';
  video.style.display = 'block';
  shotCanvas.style.display = 'none';
  shutterBtn.style.display = 'block';

  if (!window.isSecureContext) {
    alert('Камера недоступна: браузер требует HTTPS (или localhost). Сейчас страница открыта по обычному http:// — попросите бэкенд/тимлида поднять HTTPS для теста камеры.');
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = state.stream;
    video.onloadedmetadata = () => {
      video.play().catch(err => alert('Не удалось запустить видео: ' + err.message));
    };
  } catch (err) {
    alert('Не удалось получить доступ к камере: ' + err.name + ' — ' + err.message);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
}

// Бумага на фото освещена неравномерно (плавный градиент/тень), поэтому глобальный
// порог яркости не отличает тень от тонких линий рисунка. Вместо этого делим кадр
// на блоки и ищем блоки с высоким ЛОКАЛЬНЫМ контрастом (внутри блока есть и светлый
// фон, и тёмная линия рядом) — тень бумаги меняется плавно и такого контраста не даёт.
function autoCropToDrawing(sourceCanvas, padding = 24, blockSize = 16, contrastThreshold = 35) {
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext('2d');
  const data = srcCtx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;

  for (let by = 0; by < h; by += blockSize) {
    for (let bx = 0; bx < w; bx += blockSize) {
      let blockMin = 255, blockMax = 0;
      for (let y = by; y < Math.min(by + blockSize, h); y += 2) {
        for (let x = bx; x < Math.min(bx + blockSize, w); x += 2) {
          const i = (y * w + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum < blockMin) blockMin = lum;
          if (lum > blockMax) blockMax = lum;
        }
      }
      if (blockMax - blockMin > contrastThreshold) {
        found = true;
        if (bx < minX) minX = bx;
        if (bx + blockSize > maxX) maxX = bx + blockSize;
        if (by < minY) minY = by;
        if (by + blockSize > maxY) maxY = by + blockSize;
      }
    }
  }

  if (!found) return sourceCanvas; // ничего не нашли — возвращаем как есть

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w, maxX + padding);
  maxY = Math.min(h, maxY + padding);

  const cropW = maxX - minX, cropH = maxY - minY;
  const cropped = document.createElement('canvas');
  cropped.width = cropW;
  cropped.height = cropH;
  cropped.getContext('2d').drawImage(sourceCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  return cropped;
}

// Бумага освещена неравномерно (тень/градиент), поэтому один фиксированный порог
// яркости не подходит — в тени бумага темнее, чем чистые светлые линии на свету.
// Вместо этого сравниваем каждый пиксель с "размытой" (усреднённой по соседям)
// версией того же изображения: если пиксель заметно темнее своего локального
// окружения — это линия рисунка, иначе — фон бумаги, его делаем прозрачным.
function makeBackgroundTransparent(canvas, diffThreshold = 25) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const original = ctx.getImageData(0, 0, w, h);

  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w * 0.08));
  small.height = Math.max(1, Math.round(h * 0.08));
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);

  const blurred = document.createElement('canvas');
  blurred.width = w;
  blurred.height = h;
  const bctx = blurred.getContext('2d');
  bctx.drawImage(small, 0, 0, w, h); // растягиваем маленькую копию — получаем размытие
  const blurredData = bctx.getImageData(0, 0, w, h).data;

  const d = original.data;

  // Похоже-на-фон пиксели (по локальному контрасту) — но пока это только КАНДИДАТЫ.
  // Если стереть их все подряд, пострадают и замкнутые белые области ВНУТРИ рыбки
  // (непрокрашенный живот, глаза и т.п.) — а их трогать нельзя.
  const isBgCandidate = new Uint8Array(w * h);
  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const localBg = 0.299 * blurredData[i] + 0.587 * blurredData[i + 1] + 0.114 * blurredData[i + 2];
    isBgCandidate[p] = (localBg - lum < diffThreshold) ? 1 : 0;
  }

  // Заливка от краёв кадра: настоящий фон обязательно соединён с границей канваса.
  // Всё, что похоже на фон, но окружено линиями рисунка (недостижимо от края) — не трогаем.
  const reachable = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x); stack.push(x + (h - 1) * w); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + (w - 1)); }

  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= w * h || reachable[p] || !isBgCandidate[p]) continue;
    reachable[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    if (reachable[p]) d[i + 3] = 0; // настоящий фон, связанный с краем — прозрачный
  }
  ctx.putImageData(original, 0, 0);
}

shutterBtn.addEventListener('click', () => {
  const w = video.videoWidth, h = video.videoHeight;
  shotCanvas.width = w;
  shotCanvas.height = h;
  const sctx = shotCanvas.getContext('2d');
  sctx.drawImage(video, 0, 0, w, h);

  // На сервер уходит СЫРОЕ фото листа целиком (JPEG, без обрезки и без
  // прозрачности) — бэкенд сам ищет край листа и вырезает рыбку
  // (см. API_CONTRACT.md, "Формат image по режимам"). Если обрезать и
  // сделать фон прозрачным здесь, у серверного алгоритма не останется ни
  // края листа для поиска четырёхугольника, ни красок вне контура для
  // сегментации — пайплайн сломается на реальных фото.
  state.shotDataUrl = shotCanvas.toDataURL('image/jpeg', 0.85);

  // Дальше — только косметика превью на экране ребёнка, на отправку не влияет.
  const cropped = autoCropToDrawing(shotCanvas);
  shotCanvas.width = cropped.width;
  shotCanvas.height = cropped.height;
  shotCanvas.getContext('2d').drawImage(cropped, 0, 0);
  makeBackgroundTransparent(shotCanvas);

  video.style.display = 'none';
  shotCanvas.style.display = 'block';
  shutterBtn.style.display = 'none';
  scanPreviewBox.style.display = 'block';
  stopCamera();
});

document.getElementById('retakeBtn').addEventListener('click', () => {
  initCamera();
});

document.getElementById('sendScanBtn').addEventListener('click', () => {
  sendFish(state.shotDataUrl);
});

// ===================================================================
// Send to server
// ===================================================================
function sendFish(imageDataUrl) {
  showScreen('status');
  const statusBox = document.getElementById('statusBox');
  statusBox.innerHTML = `<div class="spinner"></div><div>Отправляем рыбку в аквариум...</div>`;

  const payload = {
    fishType: state.fishType,
    mode: state.mode,
    image: imageDataUrl,
    createdAt: new Date().toISOString()
  };

  fetch(getServerUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(res => {
      if (!res.ok) throw new Error('Сервер ответил: ' + res.status);
      return res.json().catch(() => ({}));
    })
    .then(() => {
      statusBox.innerHTML = `
        <div class="big-emoji">🐠</div>
        <div>Рыбка отправлена в аквариум!</div>
        <button class="btn" id="watchBtn">Смотреть аквариум 🐠</button>
        <button class="btn secondary" id="againBtn">Ещё рыбку</button>`;
      document.getElementById('watchBtn').addEventListener('click', () => {
        showScreen('aquarium');
        initAquarium();
      });
      document.getElementById('againBtn').addEventListener('click', resetFlow);
    })
    .catch(err => {
      statusBox.innerHTML = `
        <div class="big-emoji">⚠️</div>
        <div>Не получилось отправить: ${err.message}</div>
        <button class="btn secondary" id="retryBtn">Попробовать снова</button>`;
      document.getElementById('retryBtn').addEventListener('click', () => sendFish(imageDataUrl));
    });
}

function resetFlow() {
  state.mode = null;
  state.fishType = null;
  state.shotDataUrl = null;
  document.querySelectorAll('.fish-opt').forEach(o => o.classList.remove('selected'));
  toColoringBtn.disabled = true;
  showScreen('home');
}

// ===================================================================
// Built-in aquarium (тот же сайт — ребёнку не нужно открывать вторую страницу).
// Подключается к тому же серверу, что и отправка рыбок (адрес из serverUrl).
// ===================================================================
const aqua = { started: false, fishes: [], seen: new Set(), bubbles: [] };

function aquaServerOrigin() {
  try { return new URL(getServerUrl()).origin; } catch { return location.origin; }
}

function initAquarium() {
  const canvas = document.getElementById('tankCanvas');
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;

  if (aqua.started) return; // движок уже запущен — просто показываем экран
  aqua.started = true;

  const ctx2 = canvas.getContext('2d');
  const HTTP = aquaServerOrigin();
  const WS_URL = HTTP.replace(/^http/, 'ws') + '/ws/wall';

  const newBubble = () => ({
    x: Math.random() * canvas.width, y: canvas.height + Math.random() * canvas.height,
    r: 2 + Math.random() * 5, sp: 0.4 + Math.random() * 1.2, sway: Math.random() * Math.PI * 2
  });
  aqua.bubbles = Array.from({ length: 30 }, newBubble);

  function addFish(meta) {
    if (aqua.seen.has(meta.fish_id)) return;
    aqua.seen.add(meta.fish_id);
    const img = new Image();
    img.src = HTTP + meta.image_url;
    const f = {
      img, ready: false,
      x: Math.random() * canvas.width,
      baseY: 60 + Math.random() * Math.max(60, canvas.height - 180),
      vx: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9),
      phase: Math.random() * Math.PI * 2,
      size: 90 + Math.random() * 60,
      spawn: performance.now()
    };
    img.onload = () => { f.ready = true; };
    aqua.fishes.push(f);
    document.getElementById('tankCount').textContent = aqua.fishes.length;
  }

  function draw(t) {
    const W = canvas.width, H = canvas.height;
    const g = ctx2.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b4f6c'); g.addColorStop(1, '#04283e');
    ctx2.fillStyle = g; ctx2.fillRect(0, 0, W, H);

    ctx2.fillStyle = 'rgba(255,255,255,.35)';
    for (const b of aqua.bubbles) {
      b.y -= b.sp; b.sway += 0.03; b.x += Math.sin(b.sway) * 0.4;
      if (b.y < -10) Object.assign(b, newBubble());
      ctx2.beginPath(); ctx2.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx2.fill();
    }

    for (const f of aqua.fishes) {
      f.x += f.vx;
      if (f.x < -f.size) f.x = W + f.size;
      if (f.x > W + f.size) f.x = -f.size;
      const y = f.baseY + Math.sin(t / 700 + f.phase) * 14;
      if (!f.ready) continue;
      const grow = Math.min(1, (t - f.spawn) / 500);
      const s = f.size * grow;
      ctx2.save();
      ctx2.translate(f.x, y);
      if (f.vx > 0) ctx2.scale(-1, 1); // рыбка нарисована мордой влево
      ctx2.globalAlpha = grow;
      ctx2.drawImage(f.img, -s / 2, -s / 2, s, s);
      ctx2.restore();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  const dot = document.getElementById('tankDot');
  const statusEl = document.getElementById('tankStatus');
  function connect() {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => { dot.className = 'dot on'; statusEl.textContent = 'подключено'; };
    ws.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.type === 'new_fish') addFish(m); } catch {}
    };
    ws.onclose = () => { dot.className = 'dot off'; statusEl.textContent = 'переподключаюсь…'; setTimeout(connect, 1500); };
    ws.onerror = () => ws.close();
  }
  connect();

  // если WebSocket недоступен — разово подтянем очередь
  fetch(HTTP + '/api/fish/queue').then(r => r.json()).then(l => l.forEach(addFish)).catch(() => {});
}
