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
// Лёгкий canvas-аквариум на фоне экрана Сканера — та же эстетика (градиент
// воды, пузырьки, силуэты рыб), что и aquarium.html, но специально НЕ
// боид-симуляция оттуда: это фон под UI, где ребёнок тыкает кнопки и водит
// пальцем по canvas-раскраске, лишняя нагрузка на слабых телефонах ни к чему.
// ~15 fps через setInterval (не requestAnimationFrame) и пауза при уходе со
// вкладки — сознательная экономия батареи, не привет "неоптимизированный код".
function buildOceanBackground() {
  const canvas = document.getElementById('bgAquarium');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W, H;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const bubbles = Array.from({ length: 16 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: 1.5 + Math.random() * 4, vy: 0.25 + Math.random() * 0.5,
    sway: Math.random() * Math.PI * 2, swaySpd: 0.01 + Math.random() * 0.02,
  }));

  const bgFish = Array.from({ length: 3 }, (_, i) => ({
    x: Math.random() * W, baseY: H * (0.25 + i * 0.2 + Math.random() * 0.1),
    vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2),
    phase: Math.random() * Math.PI * 2, size: 34 + Math.random() * 18,
  }));

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04283e'); g.addColorStop(0.45, '#0b4f6c');
    g.addColorStop(0.8, '#157a9e'); g.addColorStop(1, '#1c95b8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    for (const b of bubbles) {
      b.y -= b.vy; b.sway += b.swaySpd; b.x += Math.sin(b.sway) * 0.3;
      if (b.y < -10) { b.y = H + 10; b.x = Math.random() * W; }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(180,230,255,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    for (const f of bgFish) {
      f.x += f.vx;
      if (f.x < -f.size) f.x = W + f.size;
      if (f.x > W + f.size) f.x = -f.size;
      const y = f.baseY + Math.sin(Date.now() / 900 + f.phase) * 10;
      ctx.save();
      ctx.translate(f.x, y);
      if (f.vx > 0) ctx.scale(-1, 1);
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size * 0.5, f.size * 0.3, 0, 0, Math.PI * 2);
      ctx.moveTo(f.size * 0.4, 0);
      ctx.lineTo(f.size * 0.75, -f.size * 0.22);
      ctx.lineTo(f.size * 0.75, f.size * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  let bgInterval = null;
  function start() {
    if (bgInterval) return;
    bgInterval = setInterval(draw, 66); // ~15fps — экономия батареи, фон не обязан быть плавным
  }
  function stop() {
    if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });
  draw();
  start();
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

// Встроенный экран-аквариум (#screen-aquarium) — dev/test-инструмент, не
// production-Стена (см. API_CONTRACT.md, раздел «Компоненты»). Обычные
// кнопки «Смотреть аквариум» теперь ведут на настоящую Стену — aquarium.html.
// Этот скрытый вход оставлен для локальной отладки Сканера без второго
// устройства: ?dev-aquarium=1 в адресной строке.
if (new URLSearchParams(location.search).has('dev-aquarium')) {
  showScreen('aquarium');
  initAquarium();
}

// ---------- Home: mode selection ----------
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    state.mode = card.dataset.mode;
    showScreen('fishtype');
  });
});

document.getElementById('toAquariumBtn').addEventListener('click', () => {
  // aquarium.html — единственный production Wall-клиент (см. API_CONTRACT.md),
  // встроенный экран-аквариум ниже — только dev-инструмент (?dev-aquarium=1).
  window.location.href = aquaServerOrigin() + '/aquarium.html';
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

  // Рыба-клоун — яйцевидное тело (заострено к носу), глаз у носа, спинной
  // горб-плавник, хвост из двух лопастей, брюшной плавник, полосы на теле.
  clownfish: (w, h) => {
    const path = new Path2D();
    const cx = 0.46, cy = 0.5, rx = 0.30, ry = 0.20;
    path.moveTo(w * (cx - rx), h * cy);
    path.bezierCurveTo(w * (cx - rx), h * (cy - ry * 1.05), w * (cx - rx * 0.3), h * (cy - ry * 1.15), w * (cx + rx * 0.35), h * (cy - ry * 0.9));
    path.bezierCurveTo(w * (cx + rx * 0.85), h * (cy - ry * 0.7), w * (cx + rx * 1.05), h * (cy - ry * 0.25), w * (cx + rx * 1.05), h * cy);
    path.bezierCurveTo(w * (cx + rx * 1.05), h * (cy + ry * 0.25), w * (cx + rx * 0.85), h * (cy + ry * 0.7), w * (cx + rx * 0.35), h * (cy + ry * 0.9));
    path.bezierCurveTo(w * (cx - rx * 0.3), h * (cy + ry * 1.15), w * (cx - rx), h * (cy + ry * 1.05), w * (cx - rx), h * cy);
    path.closePath();
    path.moveTo(w * (cx - rx * 0.5) + w * 0.045, h * (cy - ry * 0.1));
    path.ellipse(w * (cx - rx * 0.5), h * (cy - ry * 0.1), w * 0.045, h * 0.045, 0, 0, Math.PI * 2);
    addFin(path, w * (cx + rx * 0.1), h * (cy - ry * 0.95), [[w * (cx + rx * 0.25), h * (cy - ry * 1.7)], [w * (cx + rx * 0.55), h * (cy - ry * 0.85)]]);
    addFin(path, w * (cx + rx * 1.0), h * cy, [[w * (cx + rx * 1.35), h * (cy - ry * 0.9)], [w * (cx + rx * 1.10), h * cy], [w * (cx + rx * 1.35), h * (cy + ry * 0.9)]]);
    addFin(path, w * (cx + rx * 0.15), h * (cy + ry * 0.85), [[w * (cx + rx * 0.05), h * (cy + ry * 1.5)], [w * (cx + rx * 0.40), h * (cy + ry * 0.75)]]);
    for (const t of [0.20, 0.42, 0.64]) {
      const sx = w * (cx - rx + rx * 2 * t);
      path.moveTo(sx, h * (cy - ry * 0.9));
      path.quadraticCurveTo(sx + w * 0.02, h * cy, sx, h * (cy + ry * 0.9));
    }
    return path;
  },

  // Акула — веретенообразное тело, острая с обоих концов, высокий изогнутый
  // спинной плавник, несимметричный хвост-полумесяц, жабры, глаз-точка.
  shark: (w, h) => {
    const path = new Path2D();
    const cy = 0.52;
    path.moveTo(w * 0.06, h * cy);
    path.quadraticCurveTo(w * 0.25, h * (cy - 0.16), w * 0.55, h * (cy - 0.14));
    path.quadraticCurveTo(w * 0.75, h * (cy - 0.12), w * 0.90, h * cy);
    path.quadraticCurveTo(w * 0.75, h * (cy + 0.10), w * 0.55, h * (cy + 0.13));
    path.quadraticCurveTo(w * 0.25, h * (cy + 0.15), w * 0.06, h * cy);
    path.closePath();
    path.moveTo(w * 0.42, h * (cy - 0.13));
    path.quadraticCurveTo(w * 0.50, h * (cy - 0.42), w * 0.60, h * (cy - 0.14));
    path.quadraticCurveTo(w * 0.52, h * (cy - 0.20), w * 0.44, h * (cy - 0.12));
    path.closePath();
    addFin(path, w * 0.86, h * cy, [[w * 0.99, h * (cy - 0.20)], [w * 0.90, h * cy], [w * 0.97, h * (cy + 0.10)]]);
    path.moveTo(w * 0.20 + w * 0.02, h * (cy - 0.03));
    path.ellipse(w * 0.20, h * (cy - 0.03), w * 0.02, h * 0.02, 0, 0, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const gx = w * (0.34 + i * 0.035);
      path.moveTo(gx, h * (cy - 0.05));
      path.lineTo(gx, h * (cy + 0.08));
    }
    return path;
  },

  // Осьминог — круглая голова с большими глазами и улыбкой, волнистые
  // щупальца-ленты (с толщиной, а не тонкие линии), свисающие снизу.
  octopus: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.5, h * 0.34, w * 0.26, h * 0.22, 0, 0, Math.PI * 2);
    for (const ex of [0.40, 0.60]) {
      path.moveTo(w * ex + w * 0.045, h * 0.30);
      path.ellipse(w * ex, h * 0.30, w * 0.045, h * 0.05, 0, 0, Math.PI * 2);
    }
    const legCount = 7;
    for (let i = 0; i < legCount; i++) {
      const t = i / (legCount - 1);
      const ax = w * (0.24 + t * 0.52);
      const ay = h * 0.50;
      const dir = (i % 2 === 0) ? -1 : 1;
      const lw = w * 0.032;
      path.moveTo(ax - lw, ay);
      path.bezierCurveTo(ax - lw - dir * w * 0.02, ay + h * 0.14, ax + dir * w * 0.06 - lw, ay + h * 0.22, ax - lw, ay + h * 0.34);
      path.lineTo(ax + lw, ay + h * 0.34);
      path.bezierCurveTo(ax + dir * w * 0.06 + lw, ay + h * 0.22, ax + lw - dir * w * 0.02, ay + h * 0.14, ax + lw, ay);
      path.closePath();
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

  // Краб — округлое тело, глаза на стебельках сверху, две округлые клешни
  // (варежкой, с изгибом-«защипом»), лапки по бокам снизу.
  crab: (w, h) => {
    const path = new Path2D();
    path.ellipse(w * 0.5, h * 0.58, w * 0.27, h * 0.20, 0, 0, Math.PI * 2);
    for (const ex of [0.42, 0.58]) {
      path.moveTo(w * ex, h * 0.40);
      path.lineTo(w * ex, h * 0.30);
      path.moveTo(w * ex + w * 0.035, h * 0.27);
      path.ellipse(w * ex, h * 0.27, w * 0.035, h * 0.045, 0, 0, Math.PI * 2);
    }
    const claw = (cx, cy, mirror) => {
      const m = mirror ? -1 : 1;
      path.moveTo(w * (cx - m * 0.02), h * (cy + 0.10));
      path.bezierCurveTo(w * (cx - m * 0.10), h * (cy + 0.06), w * (cx - m * 0.14), h * (cy - 0.10), w * (cx - m * 0.06), h * (cy - 0.16));
      path.bezierCurveTo(w * (cx + m * 0.02), h * (cy - 0.20), w * (cx + m * 0.10), h * (cy - 0.14), w * (cx + m * 0.08), h * (cy - 0.04));
      path.bezierCurveTo(w * (cx + m * 0.06), h * (cy + 0.02), w * (cx + m * 0.02), h * (cy + 0.08), w * (cx - m * 0.02), h * (cy + 0.10));
      path.closePath();
    };
    claw(0.22, 0.42, false);
    claw(0.78, 0.42, true);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const bx = w * (0.5 + side * (0.24 + i * 0.05));
        const by = h * 0.68;
        path.moveTo(bx, by);
        path.lineTo(bx + side * w * 0.03, h * 0.78);
        path.lineTo(bx + side * w * 0.06, h * 0.74);
      }
    }
    return path;
  },

  // Дельфин — пухлое округлое тело (как на референсе), изогнутый хвостовой
  // плавник сзади, маленький плавник снизу, небольшой глаз.
  dolphin: (w, h) => {
    const path = new Path2D();
    const cx = 0.48, cy = 0.52, rx = 0.32, ry = 0.22;
    path.ellipse(w * cx, h * cy, w * rx, h * ry, 0, 0, Math.PI * 2);
    path.moveTo(w * (cx + rx * 0.85), h * (cy - ry * 0.3));
    path.bezierCurveTo(w * (cx + rx * 1.3), h * (cy - ry * 0.9), w * (cx + rx * 1.5), h * (cy - ry * 1.3), w * (cx + rx * 1.25), h * (cy - ry * 0.55));
    path.bezierCurveTo(w * (cx + rx * 1.15), h * (cy - ry * 0.35), w * (cx + rx * 0.95), h * (cy - ry * 0.15), w * (cx + rx * 0.85), h * (cy - ry * 0.3));
    path.closePath();
    addFin(path, w * (cx - rx * 0.1), h * (cy + ry * 0.85), [[w * (cx - rx * 0.35), h * (cy + ry * 1.3)], [w * (cx + rx * 0.25), h * (cy + ry * 0.85)]]);
    path.moveTo(w * (cx - rx * 0.55) + w * 0.018, h * (cy - ry * 0.15));
    path.ellipse(w * (cx - rx * 0.55), h * (cy - ry * 0.15), w * 0.018, h * 0.022, 0, 0, Math.PI * 2);
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

  // Наши силуэты (FISH_SHAPES) рисуются мордой ВЛЕВО, а клиент «Стены»
  // (aquarium.html) по умолчанию (без переворота) считает, что рыбка на
  // картинке смотрит ВПРАВО — иначе она "плывёт задом наперёд". Зеркалим
  // готовый экспорт по горизонтали, чтобы итоговый PNG соответствовал их
  // соглашению; сам процесс раскраски (внутри paintCanvas) не трогаем.
  octx.translate(w, 0);
  octx.scale(-1, 1);

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
  document.getElementById('galleryBtn').style.display = 'block';

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

  // ПРИМЕЧАНИЕ: пробовали дополнительно оставлять только "самую крупную связную
  // область" (саму рыбку), чтобы убирать редкие обрывки края стола/тени. На
  // синтетике это работало, но на реальном фото с телефона тонкая линия ручки
  // из-за антиалиасинга и сжатия JPEG сама распадается на множество мелких
  // несвязных обрывков — и "самая крупная область" оказывалась случайным
  // куском рыбки, а не рыбкой целиком (см. историю правок). Это не критично:
  // здесь только ЛОКАЛЬНОЕ превью для ребёнка, на сервер уходит сырое фото
  // (см. finishScan), которое сервер обрабатывает своим, более надёжным
  // OpenCV-пайплайном (backend/image_processing.py). Поэтому проще и надёжнее
  // остановиться на этом шаге: изредка на превью видна соринка от края стола,
  // зато рыбка на превью всегда целая.
  ctx.putImageData(original, 0, 0);
}

// Общая обработка кадра — не важно, откуда он взялся: с живой камеры или
// из файла, выбранного в галерее. drawSource — video/image/canvas, из
// которого можно ctx.drawImage(...), sw/sh — его исходные ширина/высота.
function finishScan(drawSource, sw, sh) {
  shotCanvas.width = sw;
  shotCanvas.height = sh;
  shotCanvas.getContext('2d').drawImage(drawSource, 0, 0, sw, sh);

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
  document.getElementById('galleryBtn').style.display = 'none';
  scanPreviewBox.style.display = 'block';
  stopCamera();
}

shutterBtn.addEventListener('click', () => {
  finishScan(video, video.videoWidth, video.videoHeight);
});

const galleryInput = document.getElementById('galleryInput');
document.getElementById('galleryBtn').addEventListener('click', () => {
  galleryInput.click();
});
galleryInput.addEventListener('change', () => {
  const file = galleryInput.files && galleryInput.files[0];
  galleryInput.value = ''; // чтобы выбор того же файла повторно тоже сработал
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    stopCamera(); // на телефоне выбор из галереи не глушит камеру сам по себе
    finishScan(img, img.naturalWidth, img.naturalHeight);
  };
  img.onerror = () => alert('Не удалось открыть картинку, попробуйте другой файл');
  img.src = URL.createObjectURL(file);
});

document.getElementById('retakeBtn').addEventListener('click', () => {
  document.getElementById('galleryBtn').style.display = 'block';
  initCamera();
});

document.getElementById('sendScanBtn').addEventListener('click', () => {
  sendFish(state.shotDataUrl);
});

// ===================================================================
// Send to server
// ===================================================================

// Ошибки POST /api/fish, для которых имеет смысл не "Попробовать снова" (тот же
// кадр), а "Переснять фото" (новый кадр с камеры) — проблема в содержимом/
// качестве фото, а не в сети. Бэкенд (backend/main.py) шлёт error как
// "processing_failed: <detail>" / "bad_image_data: <detail>" — сверяем по
// префиксу, а не по точному совпадению, см. API_CONTRACT.md.
const RETAKE_ERROR_MESSAGES = [
  { prefix: 'processing_failed', text: 'Не видим рыбку на листе. Попробуй переснять при хорошем свете 💡' },
  { prefix: 'bad_image_data', text: 'Не получилось прочитать фото. Попробуй переснять ещё раз 📷' }
];

function matchRetakeError(errorText) {
  if (typeof errorText !== 'string') return null;
  return RETAKE_ERROR_MESSAGES.find(e => errorText.startsWith(e.prefix)) || null;
}

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
    .then(res => res.json().catch(() => ({})).then(body => {
      if (res.ok && body && body.ok !== false) {
        showSendSuccess();
      } else {
        showSendError(body ? body.error : undefined, imageDataUrl);
      }
    }))
    .catch(() => {
      // Сеть недоступна / сервер вообще не ответил — тела ответа нет.
      showSendError(undefined, imageDataUrl);
    });
}

function showSendSuccess() {
  const statusBox = document.getElementById('statusBox');
  statusBox.innerHTML = `
    <div class="big-emoji">🐠</div>
    <div>Рыбка отправлена в аквариум!</div>
    <button class="btn" id="watchBtn">Смотреть аквариум 🐠</button>
    <button class="btn secondary" id="againBtn">Ещё рыбку</button>`;
  document.getElementById('watchBtn').addEventListener('click', () => {
    window.location.href = aquaServerOrigin() + '/aquarium.html';
  });
  document.getElementById('againBtn').addEventListener('click', resetFlow);
}

// errorText === undefined -> сетевая ошибка/5xx/нет ответа: повтор того же
// запроса имеет смысл ("Попробовать снова"). errorText начинается с
// processing_failed/bad_image_data -> проблема в самом кадре, повтор того же
// запроса даст тот же результат: нужно переснять (тот же флоу, что retakeBtn).
// Переснять фото имеет смысл только для mode=scan — в mode=draw камеры нет.
function showSendError(errorText, imageDataUrl) {
  const statusBox = document.getElementById('statusBox');
  // Known limitation: mode=draw + bad_image_data не показывает кнопку
  // "Переснять" (нет камеры в draw-режиме) и падает на общий retry ниже —
  // с тем же битым data URL, что реально не поможет. Решение отложено, риск
  // принят тимлидом 2026-07-08. См. API_CONTRACT.md, раздел Versioning.
  const retake = state.mode === 'scan' ? matchRetakeError(errorText) : null;

  if (retake) {
    statusBox.innerHTML = `
      <div class="big-emoji">📷</div>
      <div>${retake.text}</div>
      <button class="btn secondary" id="retakePhotoBtn">Переснять фото</button>`;
    document.getElementById('retakePhotoBtn').addEventListener('click', () => {
      showScreen('scan');
      initCamera();
    });
    return;
  }

  statusBox.innerHTML = `
    <div class="big-emoji">⚠️</div>
    <div>Не получилось отправить. Проверь интернет и попробуй ещё раз.</div>
    <button class="btn secondary" id="retryBtn">Попробовать снова</button>`;
  document.getElementById('retryBtn').addEventListener('click', () => sendFish(imageDataUrl));
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
      if (f.vx < 0) ctx2.scale(-1, 1); // экспорт из режима рисования теперь мордой вправо (см. sendColorBtn)
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

  // Разовая подтяжка истории при инициализации — выполняется БЕЗУСЛОВНО и
  // только один раз (не поллинг), независимо от того, поднялся WS выше или
  // нет. Если WS так и не подключится, новых рыб клиент не увидит до
  // перезагрузки страницы. Это dev/test-инструмент для Сканера, не
  // production-Стена (см. API_CONTRACT.md) — полноценный HTTP-fallback
  // с реконнект-подстраховкой реализован в aquarium.html, здесь не нужен.
  fetch(HTTP + '/api/fish/queue').then(r => r.json()).then(l => l.forEach(addFish)).catch(() => {});
}
