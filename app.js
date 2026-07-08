// ===== Устройство «Сканер» — Анимагия =====
// Два режима: (1) раскраска на экране, (2) фото раскрашенного рисунка с бумаги.
// По готовности — POST на сервер (Устройство «Стена» / бэкенд), см. serverUrl.

const state = {
  mode: null,       // 'draw' | 'scan'
  fishType: null,   // clownfish | shark | ...
  stream: null,     // camera MediaStream
  shotDataUrl: null // captured photo as data URL
};

const screens = {
  home: document.getElementById('screen-home'),
  fishtype: document.getElementById('screen-fishtype'),
  color: document.getElementById('screen-color'),
  scan: document.getElementById('screen-scan'),
  status: document.getElementById('screen-status'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function getServerUrl() {
  return document.getElementById('serverUrl').value.trim();
}

// ---------- Home: mode selection ----------
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    state.mode = card.dataset.mode;
    showScreen('fishtype');
  });
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

function initCanvas() {
  const wrapWidth = paintCanvas.parentElement.clientWidth;
  paintCanvas.width = wrapWidth;
  paintCanvas.height = Math.round(wrapWidth * 1.1);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  drawFishOutline();
  buildPalette();
}

function drawFishOutline() {
  // Simple placeholder fish silhouette so kids have something to color inside.
  const w = paintCanvas.width, h = paintCanvas.height;
  ctx.save();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(w * 0.45, h * 0.45, w * 0.32, h * 0.2, 0, 0, Math.PI * 2);
  ctx.moveTo(w * 0.75, h * 0.45);
  ctx.lineTo(w * 0.95, h * 0.3);
  ctx.lineTo(w * 0.95, h * 0.6);
  ctx.closePath();
  ctx.stroke();
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
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  drawFishOutline();
});

document.getElementById('sendColorBtn').addEventListener('click', () => {
  const dataUrl = paintCanvas.toDataURL('image/png');
  sendFish(dataUrl);
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

shutterBtn.addEventListener('click', () => {
  const w = video.videoWidth, h = video.videoHeight;
  shotCanvas.width = w;
  shotCanvas.height = h;
  const sctx = shotCanvas.getContext('2d');
  sctx.drawImage(video, 0, 0, w, h);

  const cropped = autoCropToDrawing(shotCanvas);
  shotCanvas.width = cropped.width;
  shotCanvas.height = cropped.height;
  shotCanvas.getContext('2d').drawImage(cropped, 0, 0);

  state.shotDataUrl = shotCanvas.toDataURL('image/jpeg', 0.9);

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
        <button class="btn" id="againBtn">Ещё рыбку</button>`;
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
