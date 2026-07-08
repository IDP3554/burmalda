# Чек-лист: UX ошибок отправки рыбки (`sendFish`)

Ручная проверка веткования "Попробовать снова" vs "Переснять фото" без
реального бэкенда, реального фото и реальной камеры — просто мокаем
`window.fetch` из консоли браузера. Автотестов на JS в проекте нет (нет
`package.json`/тестового раннера), поэтому это ручной чек-лист, а не `npm test`.

## Как запускать

1. Открыть `index.html` в браузере (двойной клик или локальный сервер,
   `python3 -m http.server` из корня репо, например).
2. Открыть DevTools → Console.
3. Дойти до экрана сканирования один раз (Главная → выбрать рыбу → «Сканировать
   рисунок») **или** просто вызвать `showScreen('scan')` в консоли — это нужно,
   чтобы `video`/`shotCanvas` и т.п. точно проинициализировались как элементы
   DOM (они читаются в `app.js` на загрузке скрипта).
4. Перед каждым сценарием вставлять в консоль свой блок мока `fetch` — он
   переопределяет `window.fetch` только для текущей вкладки/сессии, ничего не
   ломает в файлах.

## Сценарий 1 — `processing_failed` (mode=scan) → «Переснять фото»

```js
window.fetch = () => Promise.resolve({
  ok: false, status: 400,
  json: () => Promise.resolve({ ok: false, error: 'processing_failed: fish drawing not found on paper' })
});
state.mode = 'scan';
sendFish('data:image/jpeg;base64,dummy');
```

**Ожидается:** экран статуса — эмодзи 📷, текст «Не видим рыбку на листе.
Попробуй переснять при хорошем свете 💡», одна кнопка «Переснять фото».
Клик по ней → переключение на экран камеры (`screen-scan` становится
активным) и запрос доступа к камере (значит вызвался `initCamera()`).

## Сценарий 2 — `bad_image_data` (mode=scan) → «Переснять фото»

```js
window.fetch = () => Promise.resolve({
  ok: false, status: 400,
  json: () => Promise.resolve({ ok: false, error: 'bad_image_data: expected data URL like data:image/png;base64,....' })
});
state.mode = 'scan';
sendFish('data:image/jpeg;base64,dummy');
```

**Ожидается:** то же самое, но текст «Не получилось прочитать фото. Попробуй
переснять ещё раз 📷».

## Сценарий 3 — сеть недоступна / сервер не ответил → «Попробовать снова»

```js
window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
state.mode = 'scan';
sendFish('data:image/jpeg;base64,dummy');
```

**Ожидается:** эмодзи ⚠️, текст «Не получилось отправить. Проверь интернет и
попробуй ещё раз.», кнопка «Попробовать снова». Клик по ней должен снова
вызвать `fetch` (проверить через `Network`-вкладку или добавить
`console.log` внутрь мока) — то есть повторяется тот же POST, а не переход
на камеру.

## Сценарий 4 — HTTP 500 без тела ошибки → «Попробовать снова»

```js
window.fetch = () => Promise.resolve({
  ok: false, status: 500,
  json: () => Promise.reject(new Error('no body'))
});
state.mode = 'scan';
sendFish('data:image/jpeg;base64,dummy');
```

**Ожидается:** тот же результат, что в сценарии 3 — «Попробовать снова», не
«Переснять фото» (нет опознанного кода ошибки → дефолт на общий retry).

## Сценарий 5 — регрессия: `mode=draw` не должен вести на камеру

```js
window.fetch = () => Promise.resolve({
  ok: false, status: 400,
  json: () => Promise.resolve({ ok: false, error: 'bad_image_data: something' })
});
state.mode = 'draw';
sendFish('data:image/png;base64,dummy');
```

**Ожидается:** кнопка «Попробовать снова» (не «Переснять фото») — в draw-режиме
камеры нет, поэтому даже при content-ошибке используется общий retry-флоу
(см. `API_CONTRACT.md`, раздел «Ошибки и коды»).

## Сценарий 6 — регрессия: успешный путь не сломан

```js
window.fetch = () => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve({ ok: true, fishType: 'clownfish', mode: 'scan' })
});
sendFish('data:image/jpeg;base64,dummy');
```

**Ожидается:** экран статуса — 🐠 «Рыбка отправлена в аквариум!», две кнопки:
«Смотреть аквариум 🐠» и «Ещё рыбку» — как было до изменений.

## После проверки

Перезагрузить страницу (F5), чтобы вернуть настоящий `window.fetch` — мок
живёт только до перезагрузки/закрытия вкладки.
