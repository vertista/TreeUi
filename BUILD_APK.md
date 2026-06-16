# 🌳 TreeUi — Сборка APK для Android

## Обзор проекта

**TreeUi** — это мобильный PWA-клиент для работы с AI API (OpenAI, Claude, Gemini, OpenRouter).  
Проект написан на чистом HTML/CSS/JS без фреймворков, поэтому для упаковки в APK используется **Capacitor** — обёртка, которая встраивает веб-приложение в нативный Android WebView.

---

## Требования для сборки

| Инструмент | Версия | Как установить |
|------------|--------|----------------|
| **Node.js** | 16+ | [nodejs.org](https://nodejs.org) |
| **npm** | 8+ | Идёт с Node.js |
| **Java JDK** | 17+ | [adoptium.net](https://adoptium.net) |
| **Android Studio** | Latest | [developer.android.com](https://developer.android.com/studio) |

> [!IMPORTANT]
> Android Studio нужен для Android SDK. После установки Android Studio убедись, что установлены:
> - Android SDK (API 34+)
> - Android SDK Build-Tools
> - Android SDK Platform-Tools

---

## 🚀 Быстрая сборка (3 шага)

### Шаг 1: Установи зависимости
```bash
npm install
```

### Шаг 2: Запусти автоматическую сборку
```bash
chmod +x build-apk.sh
./build-apk.sh
```

### Шаг 3: Готово!
APK появится здесь:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 📋 Пошаговая ручная сборка

Если автоматический скрипт не подходит:

```bash
# 1. Установить зависимости
npm install

# 2. Подготовить веб-файлы
npm run prepare-www

# 3. Добавить Android платформу (только первый раз)
npx cap add android

# 4. Синхронизировать файлы
npx cap sync android

# 5. Собрать APK
cd android
./gradlew assembleDebug
```

Или через **Android Studio**:
```bash
npx cap open android
# → Build → Build Bundle(s) / APK(s) → Build APK(s)
```

---

## 🔑 Подписка Release APK

Для публикации в Google Play нужен подписанный APK:

```bash
# 1. Создать ключ подписи (один раз)
keytool -genkey -v -keystore treeui-release-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias treeui -storepass YOUR_PASSWORD

# 2. Собрать release APK
cd android
./gradlew assembleRelease

# Или через npm:
npm run build-apk-release
```

---

## 📱 Установка на телефон

### Через USB (ADB):
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### Без ADB:
1. Скопируй `app-debug.apk` на телефон (через Telegram, Email, Google Drive, USB)
2. Открой файл на телефоне
3. Разреши установку из неизвестных источников
4. Установи

---

## 🔧 Структура Capacitor проекта

```
TreeUi/
├── index.html          # Главная страница
├── app.js              # Логика приложения (2469 строк)
├── style.css           # Стили (51KB)
├── manifest.json       # PWA манифест
├── app_icon.jpg        # Иконка приложения
├── proxy-worker.js     # Cloudflare прокси (опционально)
│
├── capacitor.config.json  # ← НОВОЕ: Конфигурация Capacitor
├── package.json           # ← НОВОЕ: npm зависимости
├── build-apk.sh           # ← НОВОЕ: Автоматический билд-скрипт
│
├── scripts/
│   ├── prepare-www.js     # Копирует веб-файлы в www/
│   └── generate-icons.js  # Генерация иконок для Android
│
├── www/                   # ← Генерируется автоматически
│   └── (копии веб-файлов)
│
└── android/               # ← Генерируется Capacitor
    └── app/
        └── build/outputs/apk/  # ← Тут будет APK
```

---

## ⚠️ Известные ограничения

| Функция | В браузере | В APK | Решение |
|---------|-----------|-------|---------|
| Голосовой ввод (Speech-to-Text) | ✅ Работает | ⚠️ Ограничено | Android WebView не поддерживает Web Speech API. Используй нативный Android SpeechRecognizer |
| Text-to-Speech | ✅ Работает | ✅ Работает | Нативный TTS движок Android |
| Камера | ✅ Работает | ✅ Работает | Capacitor обрабатывает через WebChromeClient |
| Файлы | ✅ Работает | ✅ Работает | Capacitor обрабатывает file chooser |
| Clipboard | ✅ Работает | ✅ Работает | Secure context (https scheme) |

---

## 🎨 Кастомизация

### Изменить имя приложения:
В `capacitor.config.json`:
```json
"appName": "TreeUi"
```

### Изменить ID пакета:
```json
"appId": "com.treeui.chat"
```

### Изменить иконку:
Замени `app_icon.jpg` и запусти:
```bash
node scripts/generate-icons.js
```
Затем используй Android Studio → Image Asset tool для генерации всех размеров.
