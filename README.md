# TreeUi — AI Mobile UI Remake

TreeUi is a modern, lightweight, mobile-first web client wrapper for AI APIs, designed to look and feel exactly like the latest ChatGPT mobile application. It has zero heavy framework dependencies (pure HTML, CSS, JavaScript) for maximum performance, loads instantly, and runs directly in your browser.

## ✨ Features

- **ChatGPT Mobile UI Remake**: Beautiful top navigation bar, model selector dropdown, swipeable/clickable quick prompt cards, and bottom message panel.
- **Obsidian Dark Mode**: Deep black aesthetics with subtle gradients, glassmorphism, and responsive tap feedback.
- **Multi-Engine Support**: Supports **OpenAI** (GPT-4o, GPT-4o Mini), **Anthropic** (Claude 3.5 Sonnet), and **Google Gemini** (1.5 Pro, 1.5 Flash).
- **Client-Side Security**: Your API keys are saved directly in your browser's `localStorage`. Requests are sent directly to the AI provider endpoint (no middleman servers).
- **Voice Assistance**:
  - **Speech-to-Text**: Tap the microphone icon to transcribe voice queries in real-time.
  - **Text-to-Speech**: Tap the "Listen" button below any assistant response to hear the AI read it out loud.
- **Markdown & Syntax Highlighting**: Integrated markdown rendering with Prism.js auto-formatting and copy buttons for code blocks.
- **PWA Ready**: Add the app to your phone's Home Screen for a native, full-screen standalone application layout.
- **Demo Mode**: If you don't enter any API keys, the app runs in interactive simulator/demo mode, letting you play with the UI immediately!

---

## 📂 Project Structure

- `index.html` — Layout structures, PWA setups, and links to typography/icon CDNs.
- `style.css` — Color system, dark/light theme, custom scrollbars, animations, and soundwaves.
- `app.js` — Core application logic: state, storage, API call handlers, TTS/STT functions, and DOM binding.
- `manifest.json` — PWA configurations to hide the browser bar when installed.
- `app_icon.jpg` — Beautiful, generated glassmorphic application logo.

---

## 🚀 How to Run Locally

Since it's a pure front-end application, you can serve it using any web server.

### Option 1: Python (Already Running!)
A preview server is automatically running for you:
```bash
python3 -m http.server 8080 --bind 0.0.0.0
```
Open **`http://localhost:8080`** in your browser.

### Option 2: Live Server (VS Code)
If you open this folder in VS Code, right-click `index.html` and select **"Open with Live Server"**.

---

## 📱 Installing on Your Phone (PWA)

To run it full-screen on your phone:
1. Make sure your phone is connected to the same local network as this host.
2. Find the local IP address of your host machine.
3. Open the browser on your mobile phone and go to `http://<your-host-ip>:8080`.
4. **On iOS (Safari)**: Tap the **Share** button, then select **"Add to Home Screen"**.
5. **On Android (Chrome)**: Tap the three dots menu, then select **"Install App"** or **"Add to Home screen"**.
6. Open the newly added icon from your home screen. It will open without a browser frame!
