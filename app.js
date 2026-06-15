/**
 * TreeUi - Application JavaScript (Performance-Optimized)
 * Fully client-side AI Chat Wrapper and Interface
 *
 * Mobile-first optimizations:
 * - Debounced localStorage writes (300ms) with IndexedDB overflow fallback
 * - DocumentFragment-based DOM rendering — no innerHTML nuke-and-rebuild
 * - Event delegation on messageList — zero per-message listeners
 * - requestAnimationFrame typewriter with Page Visibility pause
 * - Virtualized model chip rendering with search filter
 * - AbortController for in-flight API requests
 * - Batched lucide.createIcons() — called ONCE per render cycle
 * - Instant scroll during programmatic renders; smooth only for user actions
 */

// ============================================================
// GLOBAL APP STATE
// ============================================================
let activeChatId = null;
let chats = {}; // { [id]: { id, title, provider, model, messages: [] } }
let attachedFile = null;

/** @type {AbortController|null} Active fetch controller for in-flight API calls */
let activeAbortController = null;

let settings = {
  keys: { openai: '', claude: '', gemini: '', openrouter: '' },
  providers: { openai: false, claude: false, gemini: false, openrouter: false },
  proxy: { enabled: false, url: '' },
  modelPool: {
    openai: ['gpt-4o-mini', 'gpt-4o'],
    anthropic: ['claude-3-5-sonnet-latest'],
    gemini: ['gemini-2.5-flash', 'gemini-1.5-flash'],
    openrouter: ['meta-llama/llama-3-8b-instruct:free', 'deepseek/deepseek-chat']
  },
  activeModel: 'gpt-4o-mini',
  activeProvider: 'openai',
  systemPrompt: 'You are TreeUi, a helpful, smart, and friendly AI assistant. Code blocks should be formatted clearly.',
  temperature: 0.7,
  theme: 'dark'
};

// ============================================================
// MARKDOWN PARSER SETUP
// ============================================================
let mdParser;
try {
  mdParser = window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true
  });

  // Prism-powered fenced code block renderer
  mdParser.renderer.rules.fence = function(tokens, idx) {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';
    const lang = info.split(/\s+/)[0] || '';
    const code = token.content;

    let highlighted = '';
    if (lang && Prism.languages[lang]) {
      try {
        highlighted = Prism.highlight(code, Prism.languages[lang], lang);
      } catch (_) {
        highlighted = mdParser.utils.escapeHtml(code);
      }
    } else {
      highlighted = mdParser.utils.escapeHtml(code);
    }

    const displayLang = lang || 'code';
    return `
      <div class="code-container">
        <div class="code-header">
          <span class="code-lang">${displayLang}</span>
          <button class="copy-code-btn" onclick="copyCodeText(this)">
            <i data-lucide="copy"></i> Copy
          </button>
        </div>
        <pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>
      </div>
    `;
  };
} catch (e) {
  console.warn("Markdown parser initialization failed, formatting using simple lines.", e);
}

// Global code-copy helper (used by onclick in rendered code blocks)
window.copyCodeText = function(button) {
  const container = button.closest('.code-container');
  const code = container.querySelector('code').innerText;

  navigator.clipboard.writeText(code).then(() => {
    button.innerHTML = '<i data-lucide="check"></i> Copied!';
    scheduleLucideRefresh();
    setTimeout(() => {
      button.innerHTML = '<i data-lucide="copy"></i> Copy';
      scheduleLucideRefresh();
    }, 2000);
  }).catch(err => {
    console.error("Failed to copy code: ", err);
  });
};

// ============================================================
// DOM ELEMENT REFERENCES (cached once)
// ============================================================
const elements = {
  appShell: document.getElementById('appShell'),
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  closeSidebarBtn: document.getElementById('closeSidebarBtn'),
  sidebarNewChatBtn: document.getElementById('sidebarNewChatBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  historyList: document.getElementById('historyList'),

  headerChatTitle: document.getElementById('headerChatTitle'),
  inputModelSelectorBtn: document.getElementById('inputModelSelectorBtn'),
  inputModelLabel: document.getElementById('inputModelLabel'),
  inputModelDropdown: document.getElementById('inputModelDropdown'),

  chatViewport: document.getElementById('chatViewport'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  messageList: document.getElementById('messageList'),
  scrollAnchor: document.getElementById('scrollAnchor'),
  suggestionCards: document.querySelectorAll('.suggestion-card'),

  chatInput: document.getElementById('chatInput'),
  voiceBtn: document.getElementById('voiceBtn'),
  sendBtn: document.getElementById('sendBtn'),
  attachBtn: document.getElementById('attachBtn'),

  voiceOverlay: document.getElementById('voiceOverlay'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  cancelVoiceBtn: document.getElementById('cancelVoiceBtn'),

  settingsModal: document.getElementById('settingsModal'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  resetSettingsBtn: document.getElementById('resetSettingsBtn'),

  apiKeyOpenAI: document.getElementById('apiKeyOpenAI'),
  apiKeyClaude: document.getElementById('apiKeyClaude'),
  apiKeyGemini: document.getElementById('apiKeyGemini'),
  apiKeyOpenRouter: document.getElementById('apiKeyOpenRouter'),
  settingsModelSelect: null, // Removed — model selected via input bar dropdown
  toggleOpenAI: document.getElementById('toggleOpenAI'),
  toggleClaude: document.getElementById('toggleClaude'),
  toggleGemini: document.getElementById('toggleGemini'),
  toggleOpenRouter: document.getElementById('toggleOpenRouter'),
  groupOpenAI: document.getElementById('groupOpenAI'),
  groupClaude: document.getElementById('groupClaude'),
  groupGemini: document.getElementById('groupGemini'),
  groupOpenRouter: document.getElementById('groupOpenRouter'),
  systemPrompt: document.getElementById('systemPrompt'),
  temperature: document.getElementById('temperature'),
  tempValue: document.getElementById('tempValue'),
  appTheme: document.getElementById('appTheme'),
};

// ============================================================
// SPEECH RECOGNITION & SYNTHESIS SETUP
// ============================================================
let speechRecognition = null;
let currentSpeakingUtterance = null;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechObj = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognition = new SpeechObj();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = false;
  speechRecognition.lang = 'en-US';
}

// ============================================================
// BATCHED LUCIDE ICON REFRESH
// Coalesces multiple createIcons() calls into a single rAF tick.
// ============================================================
let _lucideRafId = null;

function scheduleLucideRefresh() {
  if (_lucideRafId) return; // already scheduled
  _lucideRafId = requestAnimationFrame(() => {
    _lucideRafId = null;
    if (window.lucide) window.lucide.createIcons();
  });
}

// ============================================================
// MODEL CATALOG CONFIGS
// ============================================================
const ALL_MODELS = {
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast, lightweight model' },
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Flagship multimodal model' },
    { id: 'o1', name: 'o1', description: 'Advanced reasoning model' },
    { id: 'o1-mini', name: 'o1-mini', description: 'Fast reasoning model' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous flagship model' }
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Best Anthropic model' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Fast, efficient Claude' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Advanced reasoning Claude' }
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Latest ultra-fast model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Latest complex reasoning' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'High-speed model' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Stable reasoning model' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Stable speed model' }
  ],
  openrouter: [
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', description: 'SOTA general model' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Advanced reasoning model' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Meta flagship open-weights' },
    { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', description: 'Powerful general model' },
    { id: 'meta-llama/llama-3-8b-instruct:free', name: 'Llama 3 8B (Free)', description: 'Free low-latency llama' }
  ]
};

let modelCatalog = {};

function loadModelCatalog() {
  try {
    const stored = localStorage.getItem('treeui_model_catalog');
    if (stored) {
      modelCatalog = JSON.parse(stored);
      for (const key of ['openai', 'anthropic', 'gemini', 'openrouter']) {
        if (!modelCatalog[key]) modelCatalog[key] = [...ALL_MODELS[key]];
      }
    } else {
      modelCatalog = JSON.parse(JSON.stringify(ALL_MODELS));
    }
  } catch (e) {
    console.warn("Failed to load model catalog from localStorage", e);
    modelCatalog = JSON.parse(JSON.stringify(ALL_MODELS));
  }
}

// ============================================================
// PERSISTENCE LAYER — Debounced localStorage + IndexedDB fallback
// ============================================================
const STORAGE_KEYS = {
  chats: 'aether_chats',
  activeId: 'aether_active_chat_id',
  settings: 'aether_chat_settings'
};

let _saveDebounceTimer = null;

/**
 * Debounced save (300ms) — for non-critical writes like message appends.
 * Coalesces rapid-fire saves into a single localStorage write.
 */
function saveChatsDebounced() {
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => {
    _saveDebounceTimer = null;
    _persistChats();
  }, 300);
}

/**
 * Immediate save — for critical operations (create/delete/rename chat).
 * Also re-renders the history list since structure changed.
 */
function saveChatsToStorage() {
  if (_saveDebounceTimer) {
    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = null;
  }
  _persistChats();
  renderHistoryList();
}

/**
 * Internal: write chats + active ID to localStorage, with try/catch
 * and IndexedDB fallback for quota-exceeded errors.
 */
function _persistChats() {
  try {
    const data = JSON.stringify(chats);
    localStorage.setItem(STORAGE_KEYS.chats, data);
    localStorage.setItem(STORAGE_KEYS.activeId, activeChatId || '');
  } catch (e) {
    console.warn("localStorage write failed, attempting IndexedDB fallback", e);
    _persistToIndexedDB(chats, activeChatId);
  }
}

/** IndexedDB fallback for when localStorage quota is exceeded */
function _persistToIndexedDB(chatData, activeId) {
  try {
    const request = indexedDB.open('TreeUiBackup', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('storage')) {
        db.createObjectStore('storage');
      }
    };
    request.onsuccess = (e) => {
      try {
        const db = e.target.result;
        const tx = db.transaction('storage', 'readwrite');
        const store = tx.objectStore('storage');
        store.put(JSON.stringify(chatData), 'chats');
        store.put(activeId || '', 'activeId');
      } catch (innerErr) {
        console.error("IndexedDB write failed", innerErr);
      }
    };
    request.onerror = () => {
      console.error("IndexedDB open failed");
    };
  } catch (outerErr) {
    console.error("IndexedDB unavailable", outerErr);
  }
}

function loadChatsFromStorage() {
  try {
    const storedChats = localStorage.getItem(STORAGE_KEYS.chats);
    const storedActiveId = localStorage.getItem(STORAGE_KEYS.activeId);
    if (storedChats) {
      chats = JSON.parse(storedChats);
    }
    activeChatId = storedActiveId || null;
  } catch (e) {
    console.error("Failed to load chats from localStorage, trying IndexedDB", e);
    _loadFromIndexedDB();
    return; // async — renderHistoryList called inside callback
  }
  renderHistoryList();
}

function _loadFromIndexedDB() {
  try {
    const request = indexedDB.open('TreeUiBackup', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('storage')) {
        db.createObjectStore('storage');
      }
    };
    request.onsuccess = (e) => {
      try {
        const db = e.target.result;
        const tx = db.transaction('storage', 'readonly');
        const store = tx.objectStore('storage');
        const getChats = store.get('chats');
        const getActive = store.get('activeId');
        getChats.onsuccess = () => {
          if (getChats.result) {
            try { chats = JSON.parse(getChats.result); } catch (_) { chats = {}; }
          }
        };
        getActive.onsuccess = () => {
          activeChatId = getActive.result || null;
        };
        tx.oncomplete = () => {
          renderHistoryList();
        };
      } catch (innerErr) {
        console.error("IndexedDB read failed", innerErr);
        chats = {};
        renderHistoryList();
      }
    };
    request.onerror = () => {
      chats = {};
      renderHistoryList();
    };
  } catch (outerErr) {
    chats = {};
    renderHistoryList();
  }
}

// ============================================================
// APP INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadModelCatalog();
  loadSettings();
  loadChatsFromStorage();
  initEventListeners();
  applyTheme(settings.theme);
  fetchOnlineModels().catch(err => console.warn("Startup model sync deferred:", err));

  updateActiveModelLabels(settings.activeModel);
  populateInputModelDropdown();

  if (activeChatId && chats[activeChatId]) {
    loadChat(activeChatId);
  } else {
    showNewChatScreen();
  }

  initTypewriter();
  scheduleLucideRefresh();
});

// ============================================================
// THEME MANAGEMENT
// ============================================================
function applyTheme(theme) {
  if (theme === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('light-theme', !isDark);
  } else {
    document.body.classList.toggle('light-theme', theme === 'light');
  }

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content',
      document.body.classList.contains('light-theme') ? '#f9f9fb' : '#08090a'
    );
  }
}

// ============================================================
// SETTINGS MANAGEMENT
// ============================================================

/**
 * Renders model chip grids inside the settings modal.
 * Virtualized: renders first 50 models per provider with a "Show more" button.
 * Each provider grid gets a search filter input.
 * CSS-only checkmarks instead of lucide icons for performance.
 */
// Track virtualization state per provider
const _chipState = {
  openai: { showAll: false, query: '' },
  anthropic: { showAll: false, query: '' },
  gemini: { showAll: false, query: '' },
  openrouter: { showAll: false, query: '' }
};

const CHIP_PAGE_SIZE = 50;

function renderModelChips() {
  const renderProviderChips = (provider, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    const state = _chipState[provider];
    const allModels = modelCatalog[provider] || [];
    const pool = settings.modelPool ? (settings.modelPool[provider] || []) : [];

    // Filter by search query
    let models = allModels;
    if (state.query) {
      const q = state.query.toLowerCase();
      models = allModels.filter(m =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q))
      );
    }

    // Virtualize: only render first N unless "show all"
    const visibleCount = state.showAll ? models.length : Math.min(CHIP_PAGE_SIZE, models.length);
    const hasMore = models.length > visibleCount;

    // Preserve search input if it already exists (prevents cursor/focus loss on re-render)
    let searchInput = grid.querySelector('.model-pool-search');
    if (!searchInput) {
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'model-pool-search';
      searchInput.placeholder = `Search ${provider} models...`;
      searchInput.value = state.query;
      let _searchTimer = null;
      searchInput.addEventListener('input', () => {
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
          state.query = searchInput.value;
          state.showAll = false;
          renderProviderChips(provider, gridId);
        }, 200);
      });
    }

    // Remove everything EXCEPT the search input
    const children = Array.from(grid.children);
    children.forEach(c => { if (c !== searchInput) c.remove(); });

    // Ensure search input is the first child
    if (!grid.contains(searchInput)) {
      grid.appendChild(searchInput);
    }

    // Build chips via DocumentFragment
    const frag = document.createDocumentFragment();

    for (let i = 0; i < visibleCount; i++) {
      const model = models[i];
      const isChecked = pool.includes(model.id);
      const chip = document.createElement('div');
      chip.className = `model-chip ${isChecked ? 'active' : ''}`;
      chip.innerHTML = `
        <div class="model-chip-content">
          <div class="model-chip-title">${escapeHtml(model.name)}</div>
          <div class="model-chip-desc">${escapeHtml(model.description || model.id)}</div>
        </div>
        <div class="model-chip-check"></div>
      `;
      chip.addEventListener('click', () => {
        toggleModelInPool(provider, model.id);
      });
      frag.appendChild(chip);
    }

    // "Show more" button
    if (hasMore) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'show-more-models-btn';
      moreBtn.type = 'button';
      moreBtn.textContent = `Show all ${models.length} models`;
      moreBtn.addEventListener('click', () => {
        state.showAll = true;
        renderProviderChips(provider, gridId);
      });
      frag.appendChild(moreBtn);
    }

    grid.appendChild(frag);
  };

  renderProviderChips('openai', 'poolGridOpenAI');
  renderProviderChips('anthropic', 'poolGridClaude');
  renderProviderChips('gemini', 'poolGridGemini');
  renderProviderChips('openrouter', 'poolGridOpenRouter');
}

function toggleModelInPool(provider, modelId) {
  if (!settings.modelPool) {
    settings.modelPool = { openai: [], anthropic: [], gemini: [], openrouter: [] };
  }
  if (!settings.modelPool[provider]) {
    settings.modelPool[provider] = [];
  }

  const idx = settings.modelPool[provider].indexOf(modelId);
  if (idx > -1) {
    settings.modelPool[provider].splice(idx, 1);
  } else {
    settings.modelPool[provider].push(modelId);
  }

  renderModelChips();
  populateModelDropdown();
}

function addCustomOpenRouterModel() {
  const input = document.getElementById('customModelOpenRouter');
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;

  const exists = (modelCatalog.openrouter || []).some(m => m.id === value);
  if (!exists) {
    const newModel = {
      id: value,
      name: value.split('/').pop().toUpperCase(),
      description: 'User Custom Model'
    };
    if (!modelCatalog.openrouter) modelCatalog.openrouter = [];
    modelCatalog.openrouter.push(newModel);
    try {
      localStorage.setItem('treeui_model_catalog', JSON.stringify(modelCatalog));
    } catch (e) {
      console.warn("Failed to save model catalog", e);
    }
  }

  if (!settings.modelPool) {
    settings.modelPool = { openai: [], anthropic: [], gemini: [], openrouter: [] };
  }
  if (!settings.modelPool.openrouter) settings.modelPool.openrouter = [];
  if (!settings.modelPool.openrouter.includes(value)) {
    settings.modelPool.openrouter.push(value);
  }

  input.value = '';
  renderModelChips();
  populateModelDropdown();
}

// populateModelDropdown — removed (settings select eliminated).
// Kept as no-op stub so callers don't crash.
function populateModelDropdown() { }

function loadSettings() {
  try {
    const storedSettings = localStorage.getItem(STORAGE_KEYS.settings);
    if (storedSettings) {
      const parsed = JSON.parse(storedSettings);
      settings = { ...settings, ...parsed };

      elements.apiKeyOpenAI.value = settings.keys.openai || '';
      elements.apiKeyClaude.value = settings.keys.claude || '';
      elements.apiKeyGemini.value = settings.keys.gemini || '';
      elements.apiKeyOpenRouter.value = settings.keys.openrouter || '';
      elements.systemPrompt.value = settings.systemPrompt || '';
      elements.temperature.value = settings.temperature !== undefined ? settings.temperature : 0.7;
      elements.tempValue.textContent = settings.temperature !== undefined ? settings.temperature : 0.7;
      elements.appTheme.value = settings.theme || 'dark';

      if (settings.providers) {
        elements.toggleOpenAI.checked = !!settings.providers.openai;
        elements.toggleClaude.checked = !!settings.providers.claude;
        elements.toggleGemini.checked = !!settings.providers.gemini;
        elements.toggleOpenRouter.checked = !!settings.providers.openrouter;
      } else {
        elements.toggleOpenAI.checked = !!settings.keys.openai;
        elements.toggleClaude.checked = !!settings.keys.claude;
        elements.toggleGemini.checked = !!settings.keys.gemini;
        elements.toggleOpenRouter.checked = !!settings.keys.openrouter;
      }

      elements.groupOpenAI.classList.toggle('hidden', !elements.toggleOpenAI.checked);
      elements.groupClaude.classList.toggle('hidden', !elements.toggleClaude.checked);
      elements.groupGemini.classList.toggle('hidden', !elements.toggleGemini.checked);
      elements.groupOpenRouter.classList.toggle('hidden', !elements.toggleOpenRouter.checked);

      // Proxy settings
      if (settings.proxy) {
        const toggleProxy = document.getElementById('toggleProxy');
        const proxyUrl = document.getElementById('proxyUrl');
        const groupProxy = document.getElementById('groupProxy');
        if (toggleProxy) toggleProxy.checked = !!settings.proxy.enabled;
        if (proxyUrl) proxyUrl.value = settings.proxy.url || '';
        if (groupProxy) groupProxy.classList.toggle('hidden', !settings.proxy.enabled);
      }

      renderModelChips();
    } else {
      renderModelChips();
      populateModelDropdown();
    }
  } catch (e) {
    console.error("Failed to parse settings", e);
    renderModelChips();
    populateModelDropdown();
  }
}

function saveSettings() {
  settings.keys.openai = elements.apiKeyOpenAI.value.trim();
  settings.keys.claude = elements.apiKeyClaude.value.trim();
  settings.keys.gemini = elements.apiKeyGemini.value.trim();
  settings.keys.openrouter = elements.apiKeyOpenRouter.value.trim();

  settings.providers = {
    openai: elements.toggleOpenAI.checked,
    claude: elements.toggleClaude.checked,
    gemini: elements.toggleGemini.checked,
    openrouter: elements.toggleOpenRouter.checked
  };

  // Model selection is handled via the input bar dropdown, not settings.
  populateInputModelDropdown();

  settings.systemPrompt = elements.systemPrompt.value.trim() || 'You are a helpful AI assistant.';
  settings.temperature = parseFloat(elements.temperature.value);
  settings.theme = elements.appTheme.value;

  // Proxy settings
  const toggleProxy = document.getElementById('toggleProxy');
  const proxyUrl = document.getElementById('proxyUrl');
  settings.proxy = {
    enabled: toggleProxy ? toggleProxy.checked : false,
    url: proxyUrl ? proxyUrl.value.trim() : ''
  };

  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch (e) {
    console.warn("Failed to save settings to localStorage", e);
  }
  applyTheme(settings.theme);
  closeModal(elements.settingsModal);
}

function resetAllSettings() {
  if (confirm("Are you sure you want to clear all API keys and reset settings? Your chats will remain saved.")) {
    elements.apiKeyOpenAI.value = '';
    elements.apiKeyClaude.value = '';
    elements.apiKeyGemini.value = '';
    elements.apiKeyOpenRouter.value = '';
    elements.toggleOpenAI.checked = false;
    elements.toggleClaude.checked = false;
    elements.toggleGemini.checked = false;
    elements.toggleOpenRouter.checked = false;
    elements.groupOpenAI.classList.add('hidden');
    elements.groupClaude.classList.add('hidden');
    elements.groupGemini.classList.add('hidden');
    elements.groupOpenRouter.classList.add('hidden');

    settings.modelPool = {
      openai: ['gpt-4o-mini', 'gpt-4o'],
      anthropic: ['claude-3-5-sonnet-latest'],
      gemini: ['gemini-2.5-flash', 'gemini-1.5-flash'],
      openrouter: ['meta-llama/llama-3-8b-instruct:free', 'deepseek/deepseek-chat']
    };
    modelCatalog = JSON.parse(JSON.stringify(ALL_MODELS));
    try { localStorage.removeItem('treeui_model_catalog'); } catch (_) {}

    renderModelChips();
    populateModelDropdown();
    saveSettings();
  }
}

// ============================================================
// CHAT HISTORY & NAVIGATION
// ============================================================

function createNewChat(initialMessage = null, customProvider = null, customModel = null) {
  // Abort any in-flight request from previous chat
  abortActiveRequest();

  const provider = customProvider || settings.activeProvider;
  const model = customModel || settings.activeModel;

  const id = 'chat_' + Date.now();
  const initialMessages = [];
  if (initialMessage) {
    initialMessages.push({ role: 'user', content: initialMessage });
  }

  chats[id] = {
    id: id,
    title: initialMessage ? truncateString(initialMessage, 24) : `New Chat (${model})`,
    provider: provider,
    model: model,
    messages: initialMessages
  };

  activeChatId = id;
  saveChatsToStorage(); // Critical op → immediate save + re-render history
  loadChat(id);
}

function loadChat(id) {
  if (!chats[id]) return;

  // Abort any in-flight request from previous chat
  abortActiveRequest();

  activeChatId = id;
  try {
    localStorage.setItem(STORAGE_KEYS.activeId, id);
  } catch (_) {}

  const chat = chats[id];
  updateActiveModelLabels(chat.model);
  if (elements.headerChatTitle) {
    elements.headerChatTitle.textContent = chat.title;
  }

  elements.welcomeScreen.classList.add('hidden');
  elements.messageList.classList.remove('hidden');

  renderMessages();
  highlightSidebarItem(id);

  // Close sidebar on mobile after selection
  elements.appShell.classList.remove('sidebar-open');
}

function deleteChat(id, event) {
  if (event) event.stopPropagation();
  if (confirm("Delete this conversation?")) {
    // Abort if we're deleting the active chat
    if (activeChatId === id) abortActiveRequest();

    delete chats[id];
    if (activeChatId === id) {
      activeChatId = Object.keys(chats).length > 0 ? Object.keys(chats)[0] : null;
    }
    saveChatsToStorage(); // Critical op
    if (activeChatId) {
      loadChat(activeChatId);
    } else {
      showNewChatScreen();
    }
  }
}

function renameChat(id, event) {
  if (event) event.stopPropagation();
  const currentTitle = chats[id].title;
  const newTitle = prompt("Rename conversation:", currentTitle);
  if (newTitle && newTitle.trim()) {
    chats[id].title = newTitle.trim();
    saveChatsToStorage(); // Critical op — history structure changed
    if (activeChatId === id && elements.headerChatTitle) {
      elements.headerChatTitle.textContent = newTitle.trim();
    }
  }
}

function showNewChatScreen() {
  abortActiveRequest();
  activeChatId = null;
  try { localStorage.removeItem(STORAGE_KEYS.activeId); } catch (_) {}

  elements.messageList.classList.add('hidden');
  elements.welcomeScreen.classList.remove('hidden');
  elements.messageList.innerHTML = '';

  if (elements.headerChatTitle) {
    elements.headerChatTitle.textContent = 'TreeUi';
  }

  highlightSidebarItem(null);
}

function highlightSidebarItem(id) {
  const items = elements.historyList.querySelectorAll('.history-item');
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', items[i].dataset.id === id);
  }
}

/**
 * Renders the sidebar history list using DocumentFragment.
 * Uses event delegation on historyList instead of per-item listeners.
 */
function renderHistoryList() {
  const chatIds = Object.keys(chats).sort((a, b) => b.substring(5) - a.substring(5));

  if (chatIds.length === 0) {
    elements.historyList.innerHTML = '<div class="empty-history">No conversations yet</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  for (let i = 0; i < chatIds.length; i++) {
    const id = chatIds[i];
    const chat = chats[id];
    const item = document.createElement('div');
    item.className = `history-item ${id === activeChatId ? 'active' : ''}`;
    item.dataset.id = id;

    item.innerHTML = `
      <div class="history-title-wrap">
        <i data-lucide="message-square"></i>
        <span class="history-title-text">${escapeHtml(chat.title)}</span>
      </div>
      <div class="history-actions">
        <button class="history-action-btn edit-title" title="Rename"><i data-lucide="edit-2"></i></button>
        <button class="history-action-btn delete-chat" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    // Direct listeners on history items (small count, acceptable)
    item.addEventListener('click', () => loadChat(id));
    item.querySelector('.edit-title').addEventListener('click', (e) => renameChat(id, e));
    item.querySelector('.delete-chat').addEventListener('click', (e) => deleteChat(id, e));

    frag.appendChild(item);
  }

  elements.historyList.innerHTML = '';
  elements.historyList.appendChild(frag);
  scheduleLucideRefresh();
}

// ============================================================
// MESSAGE RENDERING — DocumentFragment + incremental append
// ============================================================

/** Track how many messages are currently rendered in the DOM */
let _renderedMessageCount = 0;

/**
 * Full re-render of all messages (used on chat load, edit, regenerate).
 * Uses DocumentFragment to batch all DOM insertions.
 */
function renderMessages() {
  if (!activeChatId || !chats[activeChatId]) return;

  const messages = chats[activeChatId].messages;
  const frag = document.createDocumentFragment();

  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    const el = createMessageElement(msg.role, msg.content, chats[activeChatId].provider, idx);
    frag.appendChild(el);
  }

  elements.messageList.innerHTML = '';
  elements.messageList.appendChild(frag);
  _renderedMessageCount = messages.length;

  scheduleLucideRefresh();
  scrollToBottom(true); // instant scroll for programmatic render
}

/**
 * Append a single new message to the DOM without re-rendering everything.
 * Used when sending/receiving individual messages.
 */
function appendMessageToDOM(role, content, provider, msgIndex = null) {
  const el = createMessageElement(role, content, provider, msgIndex);
  elements.messageList.appendChild(el);
  _renderedMessageCount++;
  scheduleLucideRefresh();
  return el;
}

/**
 * Creates a single message DOM element (no side effects).
 * Event handling is done via delegation on messageList.
 */
function createMessageElement(role, content, provider, msgIndex) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role === 'user' ? 'user' : 'assistant assistant-' + provider}`;
  if (msgIndex !== null && msgIndex !== undefined) {
    messageDiv.dataset.msgIndex = msgIndex;
  }

  const avatarChar = role === 'user' ? 'U' : 'AI';
  const senderName = role === 'user' ? 'You' : getProviderDisplayName(provider);

  // Format content and extract attachment
  let formattedContent = '';
  let attachmentHTML = '';
  let cleanContent = content;

  if (role === 'user') {
    const attachmentMatch = content.match(/^\[Attached File:\s*([^\]]+)\]\s*([\s\S]*)/);
    if (attachmentMatch) {
      const fileName = attachmentMatch[1];
      cleanContent = attachmentMatch[2] || '';

      const isImage = fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      attachmentHTML = `
        <div class="message-attachment-chip">
          <i data-lucide="${isImage ? 'image' : 'file-text'}"></i>
          <span>${escapeHtml(fileName)}</span>
        </div>
      `;
    }
    formattedContent = attachmentHTML + escapeHtml(cleanContent).replace(/\n/g, '<br>');
  } else {
    // Markdown for assistant messages
    if (mdParser) {
      formattedContent = mdParser.render(content);
    } else {
      formattedContent = escapeHtml(content).replace(/\n/g, '<br>');
    }
  }

  messageDiv.innerHTML = `
    ${role === 'user' ? `<div class="message-avatar user">U</div>` : ''}
    <div class="message-wrapper">
      ${role === 'assistant' ? `<div class="message-sender">${senderName}</div>` : ''}
      <div class="message-content">${formattedContent}</div>
      ${role === 'assistant' ? `
        <div class="message-actions">
          <button class="msg-action-btn copy-msg" title="Copy"><i data-lucide="copy"></i></button>
          <button class="msg-action-btn regenerate-msg" title="Regenerate"><i data-lucide="refresh-cw"></i></button>
        </div>
      ` : ''}
    </div>
  `;

  return messageDiv;
}

function getProviderDisplayName(provider) {
  switch (provider) {
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Claude';
    case 'gemini': return 'Gemini';
    case 'openrouter': return 'OpenRouter';
    default: return 'AI';
  }
}

// ============================================================
// EVENT DELEGATION ON messageList
// Handles copy, speak, regenerate, edit clicks without per-element listeners.
// ============================================================
function initMessageListDelegation() {
  elements.messageList.addEventListener('click', (e) => {
    const target = e.target;

    // Find the closest action button
    const actionBtn = target.closest('.msg-action-btn');
    if (!actionBtn) {
      // Check if clicking on user message content to edit
      const contentEl = target.closest('.message-content');
      if (contentEl) {
        const msgDiv = contentEl.closest('.message.user');
        if (msgDiv && msgDiv.dataset.msgIndex !== undefined) {
          enterEditMode(msgDiv, parseInt(msgDiv.dataset.msgIndex, 10));
        }
      }
      return;
    }

    const msgDiv = actionBtn.closest('.message');
    if (!msgDiv) return;
    const msgIndex = msgDiv.dataset.msgIndex !== undefined ? parseInt(msgDiv.dataset.msgIndex, 10) : null;

    // Copy message
    if (actionBtn.classList.contains('copy-msg')) {
      const rawContent = _getRawMessageContent(msgIndex);
      if (rawContent !== null) {
        navigator.clipboard.writeText(rawContent).then(() => {
          actionBtn.innerHTML = '<i data-lucide="check"></i>';
          scheduleLucideRefresh();
          setTimeout(() => {
            actionBtn.innerHTML = '<i data-lucide="copy"></i>';
            scheduleLucideRefresh();
          }, 1500);
        });
      }
      return;
    }

    // Regenerate
    if (actionBtn.classList.contains('regenerate-msg') && msgIndex !== null) {
      regenerateAiResponse(msgIndex);
      return;
    }
  });
}

/** Helper: get raw message content from chat data by index */
function _getRawMessageContent(msgIndex) {
  if (msgIndex === null || !activeChatId || !chats[activeChatId]) return null;
  const messages = chats[activeChatId].messages;
  if (msgIndex < 0 || msgIndex >= messages.length) return null;
  return messages[msgIndex].content;
}

// ============================================================
// TYPING INDICATOR
// ============================================================
function appendTypingIndicator(provider) {
  const indicator = document.createElement('div');
  indicator.id = 'typingIndicator';
  indicator.className = `message assistant assistant-${provider}`;

  indicator.innerHTML = `
    <div class="message-wrapper">
      <div class="message-sender">${getProviderDisplayName(provider)}</div>
      <div class="thinking-loader">
        <div class="thinking-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
        <div class="thinking-text">Thinking</div>
      </div>
    </div>
  `;
  elements.messageList.appendChild(indicator);
  scrollToBottom(false);
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// ============================================================
// SCROLL OPTIMIZATION
// instant for programmatic renders, smooth for user-triggered
// ============================================================
function scrollToBottom(instant = false) {
  elements.chatViewport.scrollTo({
    top: elements.chatViewport.scrollHeight,
    behavior: instant ? 'instant' : 'smooth'
  });
}

// ============================================================
// TEXT-TO-SPEECH (TTS)
// ============================================================
function toggleSpeech(text, buttonEl) {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (currentSpeakingUtterance && currentSpeakingUtterance.btn === buttonEl) {
      buttonEl.innerHTML = '<i data-lucide="volume-2"></i> Listen';
      scheduleLucideRefresh();
      currentSpeakingUtterance = null;
      return;
    }
  }

  // Reset all speak buttons
  const allSpeakBtns = elements.messageList.querySelectorAll('.speak-msg');
  for (let i = 0; i < allSpeakBtns.length; i++) {
    allSpeakBtns[i].innerHTML = '<i data-lucide="volume-2"></i> Listen';
  }

  // Clean markdown for speech
  const speechText = text.replace(/```[\s\S]*?```/g, '[Code block]')
                         .replace(/`([^`]+)`/g, '$1')
                         .replace(/[*_#\-]/g, '');

  const utterance = new SpeechSynthesisUtterance(speechText);
  utterance.onend = () => {
    buttonEl.innerHTML = '<i data-lucide="volume-2"></i> Listen';
    scheduleLucideRefresh();
    currentSpeakingUtterance = null;
  };
  utterance.onerror = () => {
    buttonEl.innerHTML = '<i data-lucide="volume-2"></i> Listen';
    scheduleLucideRefresh();
    currentSpeakingUtterance = null;
  };

  buttonEl.innerHTML = '<i data-lucide="square"></i> Stop';
  scheduleLucideRefresh();

  currentSpeakingUtterance = { utterance, btn: buttonEl };
  window.speechSynthesis.speak(utterance);
}

// ============================================================
// ABORT CONTROLLER — cancel in-flight API requests
// ============================================================
function abortActiveRequest() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

function createAbortController() {
  abortActiveRequest(); // cancel any previous
  activeAbortController = new AbortController();
  return activeAbortController;
}

// ============================================================
// PROVIDER KEY MAPPING
// Normalizes the mismatch: settings.providers uses 'claude',
// but settings.modelPool uses 'anthropic'. Maps provider key
// to the correct settings.keys key.
// ============================================================
function getApiKeyForProvider(provider) {
  // 'anthropic' provider maps to 'claude' key
  const keyName = provider === 'anthropic' ? 'claude' : provider;
  return settings.keys[keyName] || '';
}

function isProviderEnabled(provider) {
  // 'anthropic' provider maps to 'claude' toggle
  const toggleName = provider === 'anthropic' ? 'claude' : provider;
  return settings.providers && !!settings.providers[toggleName];
}

function hasApiKeyForProvider(provider) {
  return isProviderEnabled(provider) && !!getApiKeyForProvider(provider);
}

// ============================================================
// API CLIENT / INTEGRATIONS
// ============================================================
async function handleSendMessage() {
  const text = elements.chatInput.value.trim();
  if (!text && !attachedFile) return;

  let messageContent = text;
  if (attachedFile) {
    messageContent = `[Attached File: ${attachedFile.name}] ${text}`;
  }

  // Clear file preview
  const filePreviewContainer = document.getElementById('filePreviewContainer');
  filePreviewContainer.classList.add('hidden');
  filePreviewContainer.innerHTML = '';

  // Reset input
  elements.chatInput.value = '';
  elements.chatInput.style.height = '24px';
  elements.sendBtn.classList.add('hidden');
  elements.voiceBtn.classList.remove('hidden');

  const currentFile = attachedFile;
  attachedFile = null;

  // Create chat if needed
  if (!activeChatId) {
    createNewChat(messageContent);
  } else {
    chats[activeChatId].messages.push({ role: 'user', content: messageContent });
    saveChatsDebounced(); // Non-critical — debounced
    appendMessageToDOM('user', messageContent, null,
      chats[activeChatId].messages.length - 1);
    scrollToBottom(false);
  }

  const currentChat = chats[activeChatId];
  const provider = currentChat.provider;
  const model = currentChat.model;

  appendTypingIndicator(provider);

  try {
    let aiResponseText = '';

    if (!hasApiKeyForProvider(provider)) {
      // Demo mock response
      aiResponseText = await getDemoMockResponse(text, provider, model, currentFile);
      removeTypingIndicator();
      currentChat.messages.push({ role: 'assistant', content: aiResponseText });
      saveChatsDebounced();
      appendMessageToDOM('assistant', aiResponseText, provider, currentChat.messages.length - 1);
    } else {
      // Real API call with AbortController and SSE streaming
      const controller = createAbortController();
      aiResponseText = await streamAIResponse(currentChat, controller.signal);
      activeAbortController = null; // completed successfully
      currentChat.messages.push({ role: 'assistant', content: aiResponseText });
      saveChatsDebounced();
    }
    scrollToBottom(false);
  } catch (error) {
    if (error.name === 'AbortError') {
      removeTypingIndicator();
      return; // silently swallowed — user navigated away
    }
    console.error("API Error: ", error);
    removeTypingIndicator();

    let errorMessage = `⚠️ **Error calling API:** ${error.message || 'Unknown error occurred.'}`;
    if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('CORS'))) {
      errorMessage += `\n\n*Tip: Direct browser API calls can sometimes trigger CORS errors. Verify your keys are active, billing is enabled, or consider using the Gemini / OpenAI keys which allow direct client requests.*`;
    }

    currentChat.messages.push({ role: 'assistant', content: errorMessage });
    saveChatsDebounced();
    appendMessageToDOM('assistant', errorMessage, provider,
      currentChat.messages.length - 1);
    scrollToBottom(false);
  }
}

// Demo Mock Response
function getDemoMockResponse(userPrompt, provider, model, file = null) {
  return new Promise((resolve) => {
    setTimeout(() => {
      let attachmentNote = '';
      if (file) {
        attachmentNote = `📎 **Attachment Received:** **${file.name}**\n\n`;
      }

      const response = `⚠️ **API Key Missing for ${getProviderDisplayName(provider)}**
      
${attachmentNote}You are trying to query **${model}**, but no API key has been provided for **${getProviderDisplayName(provider)}**.

Please click the settings button (⚙️ **Settings & APIs** in the sidebar) and enter a valid API key to connect to live models.`;
      resolve(response);
    }, 800);
  });
}

// ============================================================
// PROXY HELPER — routes fetch through Cloudflare Worker
// ============================================================

/**
 * If proxy is enabled, sends the request to the proxy worker.
 * Otherwise, sends it directly to the API.
 * OpenRouter is NEVER proxied (it already hides IP).
 */
async function proxyFetch(targetUrl, options, signal) {
  if (settings.proxy && settings.proxy.enabled) {
    if (settings.proxy.url) {
      // Route through custom Cloudflare Worker
      const proxyUrl = settings.proxy.url.replace(/\/$/, '');
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: targetUrl,
          headers: options.headers || {},
          body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body
        }),
        signal
      });
      return response;
    } else {
      // Built-in proxy: Use corsproxy.io
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
      return fetch(proxyUrl, { ...options, signal });
    }
  }
  // Direct request
  return fetch(targetUrl, { ...options, signal });
}

// OpenAI API
async function queryOpenAI(messages, model, signal) {
  const formattedMessages = [
    { role: 'system', content: settings.systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  const targetUrl = 'https://api.openai.com/v1/chat/completions';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKeyForProvider('openai')}`
    },
    body: JSON.stringify({
      model: model,
      messages: formattedMessages,
      temperature: settings.temperature
    })
  };

  const response = await proxyFetch(targetUrl, options, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// OpenRouter API
async function queryOpenRouter(messages, model, signal) {
  const formattedMessages = [
    { role: 'system', content: settings.systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKeyForProvider('openrouter')}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'TreeUi'
    },
    body: JSON.stringify({
      model: model,
      messages: formattedMessages,
      temperature: settings.temperature
    }),
    signal
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Anthropic Claude API — proxy-aware
async function queryClaude(messages, model, signal) {
  const formattedMessages = messages.map(m => ({
    role: m.role,
    content: m.content
  }));

  const targetUrl = 'https://api.anthropic.com/v1/messages';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKeyForProvider('anthropic'),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerously-allow-browser': 'true'
    },
    body: JSON.stringify({
      model: model,
      messages: formattedMessages,
      system: settings.systemPrompt,
      max_tokens: 4096,
      temperature: settings.temperature
    })
  };

  const response = await proxyFetch(targetUrl, options, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Google Gemini API — proxy-aware, maxOutputTokens 8192
async function queryGemini(messages, model, signal) {
  const apiKey = getApiKeyForProvider('gemini');

  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents: contents,
    generationConfig: {
      temperature: settings.temperature,
      maxOutputTokens: 8192
    }
  };

  if (settings.systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: settings.systemPrompt }]
    };
  }

  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };

  const response = await proxyFetch(targetUrl, options, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
    return data.candidates[0].content.parts[0].text;
  } else {
    throw new Error("No responses received from Gemini. Maybe safety flags triggered.");
  }
}

// ============================================================
// STREAMING API FUNCTIONS
// ============================================================

/**
 * Streams an AI response with progressive DOM updates.
 * Works for all providers.
 */
async function streamAIResponse(currentChat, signal) {
  const provider = currentChat.provider;
  const model = currentChat.model;
  const messages = currentChat.messages;
  
  // Remove typing indicator and create streaming message element
  removeTypingIndicator();
  const msgIndex = currentChat.messages.length; // index after we push user message
  const streamEl = appendMessageToDOM('assistant', '', provider, msgIndex);
  const contentEl = streamEl.querySelector('.message-content');
  
  let fullText = '';
  const updateContent = (newText) => {
    fullText += newText;
    if (window.mdParser) {
      contentEl.innerHTML = window.mdParser.render(fullText);
    } else if (typeof markdownit !== 'undefined') {
      if (!window.mdParser) {
        window.mdParser = window.markdownit({
          html: true,
          linkify: true,
          typographer: true,
          highlight: function (str, lang) {
            if (lang && Prism.languages[lang]) {
              try {
                return Prism.highlight(str, Prism.languages[lang], lang);
              } catch (__) {}
            }
            return '';
          }
        });
      }
      contentEl.innerHTML = window.mdParser.render(fullText);
    } else {
      contentEl.innerHTML = escapeHtml(fullText).replace(/\n/g, '<br>');
    }
    
    // Highlight code blocks dynamically if Prism is loaded
    if (window.Prism) {
      contentEl.querySelectorAll('pre code').forEach((block) => {
        window.Prism.highlightElement(block);
      });
    }
    
    scrollToBottom(false);
  };
  
  switch (provider) {
    case 'openai':
      await streamOpenAI(messages, model, signal, updateContent);
      break;
    case 'openrouter':
      await streamOpenRouter(messages, model, signal, updateContent);
      break;
    case 'anthropic':
      await streamClaude(messages, model, signal, updateContent);
      break;
    case 'gemini':
      await streamGemini(messages, model, signal, updateContent);
      break;
    default:
      throw new Error('Unsupported provider for streaming: ' + provider);
  }
  
  scheduleLucideRefresh();
  return fullText;
}

async function streamOpenAI(messages, model, signal, onChunk) {
  const formattedMessages = [
    { role: 'system', content: settings.systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];
  
  const targetUrl = 'https://api.openai.com/v1/chat/completions';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKeyForProvider('openai')}`
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      temperature: settings.temperature,
      stream: true
    })
  };
  
  const response = await proxyFetch(targetUrl, options, signal);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  await parseSSEStream(response, (data) => {
    const content = data.choices?.[0]?.delta?.content;
    if (content) onChunk(content);
  });
}

async function streamOpenRouter(messages, model, signal, onChunk) {
  const formattedMessages = [
    { role: 'system', content: settings.systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKeyForProvider('openrouter')}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'TreeUi'
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      temperature: settings.temperature,
      stream: true
    }),
    signal
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  await parseSSEStream(response, (data) => {
    const content = data.choices?.[0]?.delta?.content;
    if (content) onChunk(content);
  });
}

async function streamClaude(messages, model, signal, onChunk) {
  const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));
  
  const targetUrl = 'https://api.anthropic.com/v1/messages';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKeyForProvider('anthropic'),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerously-allow-browser': 'true'
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      system: settings.systemPrompt,
      max_tokens: 4096,
      temperature: settings.temperature,
      stream: true
    })
  };
  
  const response = await proxyFetch(targetUrl, options, signal);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  await parseSSEStream(response, (data) => {
    if (data.type === 'content_block_delta' && data.delta?.text) {
      onChunk(data.delta.text);
    }
  });
}

async function streamGemini(messages, model, signal, onChunk) {
  const apiKey = getApiKeyForProvider('gemini');
  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));
  const payload = {
    contents,
    generationConfig: { temperature: settings.temperature, maxOutputTokens: 8192 }
  };
  if (settings.systemPrompt) {
    payload.systemInstruction = { parts: [{ text: settings.systemPrompt }] };
  }
  
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
  
  const response = await proxyFetch(targetUrl, options, signal);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  await parseSSEStream(response, (data) => {
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      onChunk(data.candidates[0].content.parts[0].text);
    }
  });
}

/** Generic SSE stream parser — works for OpenAI, Claude, and Gemini */
async function parseSSEStream(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // skip comments/empty
      if (trimmed === 'data: [DONE]') continue; // OpenAI end signal
      if (trimmed.startsWith('event:')) continue; // skip event type lines
      
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          onData(json);
        } catch (e) {
          // skip malformed JSON chunks
        }
      }
    }
  }
}

// ============================================================
// VOICE INPUT (Speech-to-Text)
// ============================================================
let voiceStream = null;
let audioContext = null;
let audioSource = null;
let analyser = null;
let animationFrameId = null;

function startAudioAnalysis(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioSource = audioContext.createMediaStreamSource(stream);
    audioSource.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const orb = document.querySelector('.voice-wave-sphere');
    const bars = document.querySelectorAll('.visualizer-bar');

    function draw() {
      if (!analyser) return;
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const scale = 1 + (average / 255) * 0.9;
      const opacity = 0.65 + (average / 255) * 0.35;

      if (orb) {
        orb.style.transform = `scale(${scale})`;
        orb.style.opacity = opacity;
        orb.style.boxShadow = `0 0 ${40 + (average / 255) * 60}px rgba(117, 66, 255, ${0.4 + (average / 255) * 0.5})`;
      }

      for (let idx = 0; idx < bars.length; idx++) {
        const dataIdx = Math.floor((idx / bars.length) * bufferLength);
        const val = dataArray[dataIdx];
        const height = 16 + (val / 255) * 90;
        bars[idx].style.height = `${height}px`;
      }
    }

    draw();
  } catch (e) {
    console.error("Audio analysis initialization failed", e);
  }
}

function stopAudioAnalysis() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }
  analyser = null;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

function startVoiceRecognition() {
  if (!speechRecognition) {
    alert("Speech recognition is not supported on this browser/device. Try using Chrome or Safari.");
    return;
  }

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  elements.voiceOverlay.classList.remove('hidden');
  elements.voiceStatusText.textContent = "Listening...";

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    voiceStream = stream;
    startAudioAnalysis(stream);
  }).catch(err => {
    console.warn("Could not start visual audio analysis: ", err);
  });

  speechRecognition.onstart = () => {
    console.log("Speech recognition started");
  };

  speechRecognition.onerror = (e) => {
    console.error("Speech recognition error", e);
    elements.voiceStatusText.textContent = "Error occurred. Try again.";
    stopVoiceRecognition();
  };

  speechRecognition.onend = () => {
    stopVoiceRecognition();
  };

  speechRecognition.onresult = (event) => {
    const result = event.results[0][0].transcript;
    if (result && result.trim()) {
      elements.chatInput.value = result;
      elements.chatInput.dispatchEvent(new Event('input'));
    }
  };

  speechRecognition.start();
}

function stopVoiceRecognition() {
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch (_) {}
  }

  stopAudioAnalysis();

  if (voiceStream) {
    voiceStream.getTracks().forEach(track => {
      try { track.stop(); } catch (_) {}
    });
    voiceStream = null;
  }

  elements.voiceOverlay.classList.add('hidden');
}

// ============================================================
// UI EVENT LISTENERS
// ============================================================
function initEventListeners() {
  // Initialize event delegation on messageList
  initMessageListDelegation();

  // Sidebar toggling
  elements.toggleSidebarBtn.addEventListener('click', () => {
    elements.appShell.classList.add('sidebar-open');
  });

  elements.closeSidebarBtn.addEventListener('click', () => {
    elements.appShell.classList.remove('sidebar-open');
  });

  elements.sidebarBackdrop.addEventListener('click', () => {
    elements.appShell.classList.remove('sidebar-open');
  });

  // New Chat
  elements.newChatBtn.addEventListener('click', showNewChatScreen);
  elements.sidebarNewChatBtn.addEventListener('click', showNewChatScreen);

  // Suggestion cards
  elements.suggestionCards.forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      elements.chatInput.value = prompt;
      elements.chatInput.dispatchEvent(new Event('input'));
      handleSendMessage();
    });
  });

  // Textarea auto-grow & button toggle
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = '24px';
    elements.chatInput.style.height = elements.chatInput.scrollHeight + 'px';

    const hasText = elements.chatInput.value.trim().length > 0;
    elements.sendBtn.classList.toggle('hidden', !hasText);
    elements.voiceBtn.classList.toggle('hidden', hasText);
  });

  // Send
  elements.sendBtn.addEventListener('click', handleSendMessage);
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Voice
  elements.voiceBtn.addEventListener('click', startVoiceRecognition);
  elements.cancelVoiceBtn.addEventListener('click', stopVoiceRecognition);

  // Settings
  elements.openSettingsBtn.addEventListener('click', () => {
    elements.appShell.classList.remove('sidebar-open');
    elements.settingsModal.classList.add('show');
    renderModelChips();
  });

  elements.closeSettingsModalBtn.addEventListener('click', () => {
    closeModal(elements.settingsModal);
  });

  elements.saveSettingsBtn.addEventListener('click', saveSettings);
  elements.resetSettingsBtn.addEventListener('click', resetAllSettings);

  // Custom OpenRouter model
  const addCustomBtn = document.getElementById('addCustomModelOpenRouterBtn');
  if (addCustomBtn) {
    addCustomBtn.addEventListener('click', addCustomOpenRouterModel);
  }
  const customInput = document.getElementById('customModelOpenRouter');
  if (customInput) {
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomOpenRouterModel();
      }
    });
  }

  // Settings modal close on backdrop click
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeModal(elements.settingsModal);
    }
  });

  // Temperature range feedback
  elements.temperature.addEventListener('input', () => {
    elements.tempValue.textContent = elements.temperature.value;
  });

  // Password visibility toggles
  document.querySelectorAll('.toggle-password-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inputId = btn.dataset.target;
      const input = document.getElementById(inputId);
      const isPassword = input.getAttribute('type') === 'password';
      input.setAttribute('type', isPassword ? 'text' : 'password');
      btn.querySelector('i').setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
      scheduleLucideRefresh();
    });
  });

  // --- Attachment Menu Handlers ---
  const attachmentMenu = document.getElementById('attachmentMenu');
  const filePreviewContainer = document.getElementById('filePreviewContainer');
  const fileInput = document.getElementById('fileInput');
  const photoInput = document.getElementById('photoInput');
  const cameraInput = document.getElementById('cameraInput');
  const attachCamera = document.getElementById('attachCamera');
  const attachPhotos = document.getElementById('attachPhotos');
  const attachFiles = document.getElementById('attachFiles');

  elements.attachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (elements.inputModelDropdown) elements.inputModelDropdown.classList.remove('show');

    const isShowing = attachmentMenu.classList.toggle('show');
    elements.attachBtn.classList.toggle('open', isShowing);
  });

  // Input model selector dropdown
  if (elements.inputModelSelectorBtn && elements.inputModelDropdown) {
    elements.inputModelSelectorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (attachmentMenu) {
        attachmentMenu.classList.remove('show');
        elements.attachBtn.classList.remove('open');
      }
      elements.inputModelDropdown.classList.toggle('show');
    });
  }

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (attachmentMenu && !attachmentMenu.contains(e.target) && e.target !== elements.attachBtn) {
      attachmentMenu.classList.remove('show');
      elements.attachBtn.classList.remove('open');
    }
    if (elements.inputModelDropdown && !elements.inputModelDropdown.contains(e.target) &&
        (!elements.inputModelSelectorBtn || !elements.inputModelSelectorBtn.contains(e.target))) {
      elements.inputModelDropdown.classList.remove('show');
    }
  });

  // Attachment button triggers
  attachCamera.addEventListener('click', () => {
    cameraInput.click();
    attachmentMenu.classList.remove('show');
    elements.attachBtn.classList.remove('open');
  });

  attachPhotos.addEventListener('click', () => {
    photoInput.click();
    attachmentMenu.classList.remove('show');
    elements.attachBtn.classList.remove('open');
  });

  attachFiles.addEventListener('click', () => {
    fileInput.click();
    attachmentMenu.classList.remove('show');
    elements.attachBtn.classList.remove('open');
  });

  // File selection handler
  const handleFileSelection = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    attachedFile = {
      name: file.name,
      type: file.type,
      size: file.size,
      fileObj: file
    };

    filePreviewContainer.innerHTML = '';
    const chip = document.createElement('div');
    chip.className = 'preview-chip';

    if (file.type.startsWith('image/')) {
      const imgUrl = URL.createObjectURL(file);
      chip.innerHTML = `
        <img src="${imgUrl}" alt="Preview">
        <span>${truncateString(file.name, 15)}</span>
        <button class="remove-preview-btn" type="button"><i data-lucide="x"></i></button>
      `;
    } else {
      chip.innerHTML = `
        <i data-lucide="file-text"></i>
        <span>${truncateString(file.name, 15)}</span>
        <button class="remove-preview-btn" type="button"><i data-lucide="x"></i></button>
      `;
    }

    chip.querySelector('.remove-preview-btn').addEventListener('click', () => {
      attachedFile = null;
      filePreviewContainer.classList.add('hidden');
      filePreviewContainer.innerHTML = '';
      e.target.value = '';
      elements.chatInput.dispatchEvent(new Event('input'));
    });

    filePreviewContainer.appendChild(chip);
    filePreviewContainer.classList.remove('hidden');

    elements.sendBtn.classList.remove('hidden');
    elements.voiceBtn.classList.add('hidden');

    scheduleLucideRefresh();
  };

  cameraInput.addEventListener('change', handleFileSelection);
  photoInput.addEventListener('change', handleFileSelection);
  fileInput.addEventListener('change', handleFileSelection);

  // Provider toggles
  const bindToggle = (checkbox, group) => {
    checkbox.addEventListener('change', () => {
      group.classList.toggle('hidden', !checkbox.checked);
      populateModelDropdown();
    });
  };

  bindToggle(elements.toggleOpenAI, elements.groupOpenAI);
  bindToggle(elements.toggleClaude, elements.groupClaude);
  bindToggle(elements.toggleGemini, elements.groupGemini);
  bindToggle(elements.toggleOpenRouter, elements.groupOpenRouter);

  // Proxy toggle
  const toggleProxy = document.getElementById('toggleProxy');
  const groupProxy = document.getElementById('groupProxy');
  if (toggleProxy && groupProxy) {
    toggleProxy.addEventListener('change', () => {
      groupProxy.classList.toggle('hidden', !toggleProxy.checked);
    });
  }
}

function updateSelectedModel(model, provider, name) {
  updateActiveModelLabels(model);
}

function closeModal(modalEl) {
  modalEl.classList.remove('show');
}

// ============================================================
// HELPER UTILITIES
// ============================================================
function truncateString(str, num) {
  if (str.length <= num) return str;
  return str.slice(0, num) + '...';
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

// ============================================================
// TYPEWRITER EFFECT — requestAnimationFrame with Visibility API
// Stops completely when page/tab is hidden, restarts when visible.
// ============================================================
function initTypewriter() {
  const greetingEl = document.getElementById('welcomeGreeting');
  if (!greetingEl) return;

  const greetings = [
    "How can I help you today?",
    "What would you like to build?",
    "Need help writing some code?",
    "Let's brainstorm something new.",
    "What shall we create today?",
    "Design a new project with me.",
    "Ask me anything..."
  ];

  let index = 0;
  let charIndex = 0;
  let isDeleting = false;
  let text = '';
  let _typewriterRafId = null;
  let _lastTypeTime = 0;
  let _currentDelay = 60; // ms between frames

  function type(timestamp) {
    // Only run if welcome screen is visible
    const welcomeScreen = elements.welcomeScreen;
    if (!welcomeScreen || welcomeScreen.classList.contains('hidden') || document.hidden) {
      // Page hidden or welcome hidden — stop the loop, will be restarted
      _typewriterRafId = null;
      return;
    }

    // Throttle to the desired delay using timestamp
    if (timestamp - _lastTypeTime < _currentDelay) {
      _typewriterRafId = requestAnimationFrame(type);
      return;
    }
    _lastTypeTime = timestamp;

    const currentFullText = greetings[index];

    if (isDeleting) {
      text = currentFullText.substring(0, charIndex - 1);
      charIndex--;
    } else {
      text = currentFullText.substring(0, charIndex + 1);
      charIndex++;
    }

    greetingEl.innerHTML = text + '<span class="typewriter-cursor">|</span>';

    if (!isDeleting && charIndex === currentFullText.length) {
      _currentDelay = 2500; // pause at end
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      index = (index + 1) % greetings.length;
      _currentDelay = 400; // pause before next
    } else {
      _currentDelay = isDeleting ? 30 : 60;
    }

    _typewriterRafId = requestAnimationFrame(type);
  }

  function startTypewriter() {
    if (_typewriterRafId) return; // already running
    _lastTypeTime = 0;
    _typewriterRafId = requestAnimationFrame(type);
  }

  function stopTypewriter() {
    if (_typewriterRafId) {
      cancelAnimationFrame(_typewriterRafId);
      _typewriterRafId = null;
    }
  }

  // Visibility API: pause when hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTypewriter();
    } else {
      startTypewriter();
    }
  });

  startTypewriter();
}

// ============================================================
// INLINE MESSAGE EDITING & RESPONSE REGENERATION
// ============================================================
function enterEditMode(messageDiv, msgIndex) {
  if (!activeChatId || !chats[activeChatId]) return;
  const messages = chats[activeChatId].messages;
  if (msgIndex < 0 || msgIndex >= messages.length) return;
  const originalMessage = messages[msgIndex];

  let textToEdit = originalMessage.content;
  const attachmentMatch = originalMessage.content.match(/^\[Attached File:\s*([^\]]+)\]\s*([\s\S]*)/);
  if (attachmentMatch) {
    textToEdit = attachmentMatch[2] || '';

    // Restore file preview chip
    const fileName = attachmentMatch[1];
    attachedFile = { name: fileName, type: '', size: 0 };
    const filePreviewContainer = document.getElementById('filePreviewContainer');
    if (filePreviewContainer) {
      filePreviewContainer.innerHTML = `
        <div class="preview-chip">
          <i data-lucide="file-text"></i>
          <span>${truncateString(fileName, 15)}</span>
          <button class="remove-preview-btn" type="button"><i data-lucide="x"></i></button>
        </div>
      `;
      filePreviewContainer.querySelector('.remove-preview-btn').addEventListener('click', () => {
        attachedFile = null;
        filePreviewContainer.classList.add('hidden');
        filePreviewContainer.innerHTML = '';
        elements.chatInput.dispatchEvent(new Event('input'));
      });
      filePreviewContainer.classList.remove('hidden');
      scheduleLucideRefresh();
    }
  }

  // Copy to prompt input
  elements.chatInput.value = textToEdit;
  elements.chatInput.style.height = '24px';
  elements.chatInput.style.height = elements.chatInput.scrollHeight + 'px';
  elements.chatInput.focus();
  elements.chatInput.dispatchEvent(new Event('input'));

  // Truncate conversation to this point
  chats[activeChatId].messages = chats[activeChatId].messages.slice(0, msgIndex);
  saveChatsDebounced();
  renderMessages();
}

// submitEditedMessage — REMOVED (dead code, never called)

async function regenerateAiResponse(msgIndex) {
  if (!activeChatId || !chats[activeChatId]) return;
  const currentChat = chats[activeChatId];

  currentChat.messages = currentChat.messages.slice(0, msgIndex);
  saveChatsDebounced();
  renderMessages();

  const provider = currentChat.provider;
  const model = currentChat.model;

  appendTypingIndicator(provider);

  try {
    let aiResponseText = '';
    const lastUserMsg = currentChat.messages.length > 0
      ? currentChat.messages[currentChat.messages.length - 1].content
      : '';
    let currentFile = null;
    const attachmentMatch = lastUserMsg.match(/^\[Attached File:\s*([^\]]+)\]/);
    if (attachmentMatch) {
      currentFile = { name: attachmentMatch[1], type: '', size: 0 };
    }

    if (!hasApiKeyForProvider(provider)) {
      aiResponseText = await getDemoMockResponse(lastUserMsg, provider, model, currentFile);
      removeTypingIndicator();
      currentChat.messages.push({ role: 'assistant', content: aiResponseText });
      saveChatsDebounced();
      appendMessageToDOM('assistant', aiResponseText, provider, currentChat.messages.length - 1);
    } else {
      const controller = createAbortController();
      aiResponseText = await streamAIResponse(currentChat, controller.signal);
      activeAbortController = null;
      currentChat.messages.push({ role: 'assistant', content: aiResponseText });
      saveChatsDebounced();
    }
    scrollToBottom(false);
  } catch (error) {
    if (error.name === 'AbortError') {
      removeTypingIndicator();
      return;
    }
    console.error("API Error: ", error);
    removeTypingIndicator();
    let errorMessage = `⚠️ **Error calling API:** ${error.message || 'Unknown error occurred.'}`;
    currentChat.messages.push({ role: 'assistant', content: errorMessage });
    saveChatsDebounced();
    appendMessageToDOM('assistant', errorMessage, provider,
      currentChat.messages.length - 1);
    scrollToBottom(false);
  }
}

// ============================================================
// ONLINE MODELS SYNC FROM OPENROUTER API
// ============================================================
async function fetchOnlineModels() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) throw new Error("Status " + response.status);
    const result = await response.json();
    if (result && result.data && Array.isArray(result.data)) {
      result.data.forEach(model => {
        const id = model.id;
        const name = model.name || id.split('/').pop();
        const description = model.description || 'Online Model';

        const modelObj = { id, name, description };

        if (!modelCatalog.openrouter.some(m => m.id === id)) {
          modelCatalog.openrouter.push(modelObj);
        }

        // Extract native provider models
        if (id.startsWith('openai/') && !id.includes(':')) {
          const cleanId = id.replace('openai/', '');
          if (!modelCatalog.openai.some(m => m.id === cleanId)) {
            modelCatalog.openai.push({ id: cleanId, name: name.replace('OpenAI: ', ''), description });
          }
        }

        if (id.startsWith('anthropic/') && !id.includes(':')) {
          const cleanId = id.replace('anthropic/', '');
          if (!modelCatalog.anthropic.some(m => m.id === cleanId)) {
            modelCatalog.anthropic.push({ id: cleanId, name: name.replace('Anthropic: ', ''), description });
          }
        }

        if (id.startsWith('google/gemini-') && !id.includes(':')) {
          const cleanId = id.replace('google/', '');
          if (!modelCatalog.gemini.some(m => m.id === cleanId)) {
            modelCatalog.gemini.push({ id: cleanId, name: name.replace('Google: ', ''), description });
          }
        }
      });

      try {
        localStorage.setItem('treeui_model_catalog', JSON.stringify(modelCatalog));
      } catch (e) {
        console.warn("Failed to save model catalog", e);
      }
      console.log(`Synced ${result.data.length} models online successfully.`);

      renderModelChips();
      populateModelDropdown();
    }
  } catch (err) {
    console.warn("Could not sync online models: ", err);
    throw err;
  }
}

// ============================================================
// UNIFIED MODEL LABELS AND INPUT BAR DROPDOWN
// ============================================================
function getShortModelName(modelId) {
  if (!modelId) return 'Model';

  let name = modelId.split('/').pop();

  name = name.replace('-latest', '')
             .replace('-instruct', '')
             .replace(':free', '')
             .replace('-20241217', '')
             .replace('-20240229', '')
             .replace('gemini-', '')
             .replace('claude-', '');

  if (name.length > 10) {
    name = name.slice(0, 8) + '..';
  }
  return name;
}

function updateActiveModelLabels(modelName) {
  if (elements.inputModelLabel) {
    elements.inputModelLabel.textContent = getShortModelName(modelName);
  }
}

function populateInputModelDropdown() {
  const dropdown = elements.inputModelDropdown;
  if (!dropdown) return;

  const frag = document.createDocumentFragment();

  const hasOpenAI = settings.providers?.openai;
  const hasClaude = settings.providers?.claude;
  const hasGemini = settings.providers?.gemini;
  const hasOpenRouter = settings.providers?.openrouter;

  let modelsAdded = 0;

  const addGroupItems = (provider, providerKey) => {
    const pool = settings.modelPool ? (settings.modelPool[provider] || []) : [];
    pool.forEach(modelId => {
      const catalogItem = (modelCatalog[provider] || []).find(m => m.id === modelId);
      const name = catalogItem ? catalogItem.name : modelId;

      const isActive = settings.activeModel === modelId && settings.activeProvider === providerKey;

      const btn = document.createElement('button');
      btn.className = `model-dropdown-item ${isActive ? 'active' : ''}`;
      btn.type = 'button';
      btn.innerHTML = `
        <div class="model-dropdown-item-info">
          <span>${escapeHtml(name)}</span>
        </div>
        ${isActive ? '<div class="model-dropdown-item-check"><i data-lucide="check"></i></div>' : ''}
      `;

      btn.addEventListener('click', () => {
        settings.activeModel = modelId;
        settings.activeProvider = providerKey;
        updateActiveModelLabels(modelId);
        try {
          localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
        } catch (_) {}
        dropdown.classList.remove('show');

        if (activeChatId && chats[activeChatId]) {
          chats[activeChatId].model = modelId;
          chats[activeChatId].provider = providerKey;
          saveChatsDebounced();
        }

        populateInputModelDropdown();
      });

      frag.appendChild(btn);
      modelsAdded++;
    });
  };

  if (hasOpenAI) addGroupItems('openai', 'openai');
  if (hasClaude) addGroupItems('anthropic', 'anthropic');
  if (hasGemini) addGroupItems('gemini', 'gemini');
  if (hasOpenRouter) addGroupItems('openrouter', 'openrouter');

  if (modelsAdded === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.padding = '10px';
    emptyNotice.style.fontSize = '0.78rem';
    emptyNotice.style.color = 'var(--text-tertiary)';
    emptyNotice.style.textAlign = 'center';
    emptyNotice.innerHTML = `No models in pool.<br><a href="#" id="emptyDropdownSettingsLink" style="color: var(--md-primary); text-decoration: underline; font-weight:600; display:inline-block; margin-top:4px;">Open Settings</a>`;
    frag.appendChild(emptyNotice);
  }

  dropdown.innerHTML = '';
  dropdown.appendChild(frag);

  const link = dropdown.querySelector('#emptyDropdownSettingsLink');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      dropdown.classList.remove('show');
      elements.settingsModal.classList.add('show');
    });
  }

  scheduleLucideRefresh();
}
