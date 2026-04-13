// ═══════════════════════════════════════════
// ST Fanfic Director — index.js (v2)
// Simplified: extension drawer only, API settings + persona speech macro
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { getContext } from '../../../st-context.js';
import { event_types, eventSource } from '../../../events.js';

const EXT_NAME = 'st-fanfic-director';

const defaultSettings = {
    extraApi: {
        endpoint: '',
        key: '',
        model: '',
        contextMessages: 10,
    },
    optionsFor:    'user',      // 'user' | 'all'
    optionsPerson: 'second',    // 'first' | 'second' | 'third'
    optionsStyle:  'compact',   // 'compact' | 'expanded'
    customPrompt:  '',          // '' = auto-build; non-empty = user override
    presets:       [],          // [{name:string, prompt:string}]
    lastOptions:   null,        // {chatKey:string, options:[], style:string}
    personaSpeechMap: {},       // { [personaName]: 'speech examples string' }
};

// ───────────────────────────────────────────
// Settings helpers
// ───────────────────────────────────────────
function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(defaultSettings);
    }
    return extension_settings[EXT_NAME];
}

function loadSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(defaultSettings);
    } else {
        const s = extension_settings[EXT_NAME];
        if (!s.extraApi) s.extraApi = structuredClone(defaultSettings.extraApi);
        for (const key in defaultSettings.extraApi) {
            if (s.extraApi[key] === undefined) s.extraApi[key] = defaultSettings.extraApi[key];
        }
        if (s.optionsFor === undefined)    s.optionsFor    = defaultSettings.optionsFor;
        if (s.optionsPerson === undefined)  s.optionsPerson = defaultSettings.optionsPerson;
        if (s.optionsStyle === undefined)   s.optionsStyle  = defaultSettings.optionsStyle;
        if (s.customPrompt === undefined)   s.customPrompt  = defaultSettings.customPrompt;
        if (s.presets === undefined)        s.presets       = defaultSettings.presets;
        if (s.lastOptions === undefined)    s.lastOptions   = defaultSettings.lastOptions;
        if (!s.personaSpeechMap)            s.personaSpeechMap = {};

        // Migrate old flat personaSpeech → personaSpeechMap
        if (s.optionsFor === 'character') s.optionsFor = 'all';
        if (s.personaSpeech && typeof s.personaSpeech === 'string') {
            try {
                const ctx = getContext();
                const personaKey = ctx?.name1 || 'Default';
                if (!s.personaSpeechMap[personaKey]) {
                    s.personaSpeechMap[personaKey] = s.personaSpeech;
                }
            } catch {
                if (!s.personaSpeechMap['Default']) {
                    s.personaSpeechMap['Default'] = s.personaSpeech;
                }
            }
            delete s.personaSpeech;
            saveSettingsDebounced();
        }
    }
    console.log('[FanficDirector] Settings loaded');
}

// ───────────────────────────────────────────
// Extra API
// ───────────────────────────────────────────
async function testConnection() {
    const s = getSettings();
    const api = s.extraApi;

    if (!api.endpoint || !api.key) {
        toastr.warning('Fanfic Director: укажи эндпоинт и ключ');
        return;
    }

    const endpoint = api.endpoint.replace(/\/+$/, '');
    const url = endpoint.endsWith('/chat/completions')
        ? endpoint
        : `${endpoint}/chat/completions`;

    const testBtn = document.getElementById('fd-test-btn');
    if (testBtn) { testBtn.disabled = true; testBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Тест...'; }

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${api.key}`,
            },
            body: JSON.stringify({
                model: api.model || 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
                max_tokens: 10,
            }),
        });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 100)}`);
        }
        const data = await resp.json();
        const reply = data?.choices?.[0]?.message?.content || '(empty)';
        toastr.success(`✅ ${reply.slice(0, 80)}`, 'Fanfic Director');
    } catch (err) {
        toastr.error(`❌ ${err.message}`, 'Fanfic Director');
    } finally {
        if (testBtn) { testBtn.disabled = false; testBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Тест'; }
    }
}

async function refreshModels() {
    const s = getSettings();
    const api = s.extraApi;

    if (!api.endpoint || !api.key) {
        toastr.warning('Fanfic Director: укажи эндпоинт и ключ');
        return;
    }

    const endpoint = api.endpoint.replace(/\/+$/, '');
    const url = endpoint.endsWith('/models') ? endpoint : `${endpoint}/models`;

    const btn = document.getElementById('fd-refresh-models-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    try {
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${api.key}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const models = (data?.data || []).map(m => m.id).filter(Boolean);
        _populateModelSelect(models, api.model);
        toastr.info(`📋 Найдено моделей: ${models.length}`, 'Fanfic Director');
    } catch (err) {
        toastr.error(`❌ ${err.message}`, 'Fanfic Director');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i>'; }
    }
}

function _populateModelSelect(models, current) {
    const sel = document.getElementById('fd-model-select');
    if (!sel) return;
    sel.innerHTML = '';

    if (!models.length) {
        sel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: '— нет моделей —' }));
        return;
    }

    models.forEach(id => {
        const opt = Object.assign(document.createElement('option'), { value: id, textContent: id });
        if (id === current) opt.selected = true;
        sel.appendChild(opt);
    });

    if (current && !models.includes(current)) {
        const opt = Object.assign(document.createElement('option'), { value: current, textContent: current, selected: true });
        sel.insertBefore(opt, sel.firstChild);
    }
}

function saveApiSettings() {
    const s = getSettings();
    const epEl = document.getElementById('fd-endpoint');
    const keyEl = document.getElementById('fd-api-key');
    const modelEl = document.getElementById('fd-model-select');
    const ctxEl = document.getElementById('fd-context-messages');

    if (epEl) s.extraApi.endpoint = epEl.value.trim();
    if (keyEl) s.extraApi.key = keyEl.value.trim();
    if (modelEl) s.extraApi.model = modelEl.value.trim();
    if (ctxEl) s.extraApi.contextMessages = parseInt(ctxEl.value) || 10;

    saveSettingsDebounced();
    toastr.success('✅ Настройки сохранены', 'Fanfic Director');
}

function syncSettingsPanel() {
    const s = getSettings();
    const api = s.extraApi;

    const epEl = document.getElementById('fd-endpoint');
    const keyEl = document.getElementById('fd-api-key');
    const modelEl = document.getElementById('fd-model-select');
    const ctxEl = document.getElementById('fd-context-messages');

    if (epEl) epEl.value = api.endpoint || '';
    if (keyEl) keyEl.value = api.key || '';
    if (ctxEl) ctxEl.value = api.contextMessages ?? 10;

    if (modelEl && api.model) {
        const existing = [...modelEl.options].find(o => o.value === api.model);
        if (!existing && api.model) {
            const opt = Object.assign(document.createElement('option'), { value: api.model, textContent: api.model, selected: true });
            modelEl.insertBefore(opt, modelEl.firstChild);
        } else if (existing) {
            existing.selected = true;
        }
    }
}

// ───────────────────────────────────────────
// Persona speech macro
// ───────────────────────────────────────────
function registerPersonaSpeechMacro() {
    try {
        const ctx = getContext();
        if (!ctx?.macros?.register) {
            console.warn('[FanficDirector] macros API not available');
            return;
        }
        ctx.macros.register('personaspeech', {
            description: 'Returns speech examples from the active persona (set in Extensions → Fanfic Director persona field)',
            handler: () => {
                return getPersonaSpeechExamples();
            },
        });
        console.log('[FanficDirector] {{personaspeech}} macro registered');
    } catch (err) {
        console.warn('[FanficDirector] Could not register macro:', err);
    }
}

function _getActivePersonaKey() {
    try {
        const ctx = getContext();
        return ctx?.name1 || 'Default';
    } catch { return 'Default'; }
}

function getPersonaSpeechExamples() {
    const s = getSettings();
    const key = _getActivePersonaKey();
    return s.personaSpeechMap?.[key] || '';
}

// ───────────────────────────────────────────
// Inject "Speech Examples" field into ST's persona panel
// ───────────────────────────────────────────
function injectPersonaSpeechField() {
    // ST's persona management panel lives inside #persona-management-block or similar.
    // We add our field right after the persona description textarea.
    // We poll until the element exists (ST may load it lazily).
    let attempts = 0;

    const tryInject = () => {
        // Already injected?
        if (document.getElementById('fd-persona-speech-field')) return;

        // Try to find the persona description area.
        // In ST the persona form lives inside #persona-management-block
        const personaBlock = document.getElementById('persona-management-block');
        if (!personaBlock) {
            if (attempts++ < 20) setTimeout(tryInject, 500);
            return;
        }

        // Find a good insertion point: after the last .form_create_bottom or at end of block
        const insertAfter = personaBlock.querySelector('textarea#persona_description') ||
                            personaBlock.querySelector('.persona_description') ||
                            null;

        const wrapper = document.createElement('div');
        wrapper.id = 'fd-persona-speech-field';
        wrapper.className = 'fd-persona-speech-wrapper';
        wrapper.innerHTML = `
            <label class="fd-persona-speech-label" for="fd-persona-speech-textarea">
                <i class="fa-solid fa-comment-dots"></i>
                Примеры речи <span class="fd-persona-speech-macro">{{personaspeech}}</span>
                <span id="fd-persona-speech-persona-name" class="fd-persona-speech-persona-name"></span>
            </label>
            <textarea
                id="fd-persona-speech-textarea"
                class="text_pole fd-persona-speech-textarea"
                placeholder="Введи примеры фраз этой персоны — они сохраняются отдельно для каждой"
                rows="4"
            ></textarea>
            <div class="fd-persona-speech-hint">
                Вставь <code>{{personaspeech}}</code> в промпт — макрос подставит примеры <b>активной</b> персоны.
            </div>
        `;

        // Load saved value for current persona
        _syncPersonaSpeechTextarea(wrapper);

        // Save on change — per persona
        wrapper.querySelector('#fd-persona-speech-textarea').addEventListener('input', (e) => {
            const s = getSettings();
            const key = _getActivePersonaKey();
            s.personaSpeechMap[key] = e.target.value;
            saveSettingsDebounced();
        });

        // Insert after persona description textarea, or append to block
        if (insertAfter && insertAfter.parentNode) {
            insertAfter.parentNode.insertBefore(wrapper, insertAfter.nextSibling);
        } else {
            personaBlock.appendChild(wrapper);
        }

        console.log('[FanficDirector] Persona speech field injected');
    };

    tryInject();
}

/** Sync the persona-speech textarea with the current active persona's saved speech. */
function _syncPersonaSpeechTextarea(wrapperEl) {
    const wrapper = wrapperEl || document.getElementById('fd-persona-speech-field');
    if (!wrapper) return;
    const ta = wrapper.querySelector('#fd-persona-speech-textarea');
    const nameEl = wrapper.querySelector('#fd-persona-speech-persona-name');
    if (!ta) return;

    const s = getSettings();
    const key = _getActivePersonaKey();
    ta.value = s.personaSpeechMap?.[key] || '';
    if (nameEl) nameEl.textContent = `(${key})`;
}

// ───────────────────────────────────────────
// Build & inject Extensions drawer UI
// ───────────────────────────────────────────
function setupUI() {
    // Avoid double-inject
    if (document.getElementById('fd-ext-drawer')) return;

    const s = getSettings();

    const extSettingsHtml = `
<div id="fd-ext-drawer" class="fd-ext-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-signature"></i> Fanfic Director</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="fd-settings-body">

                <!-- API Endpoint -->
                <div class="fd-field-group">
                    <label class="fd-label" for="fd-endpoint">
                        <i class="fa-solid fa-link"></i> API Endpoint
                    </label>
                    <input type="text" id="fd-endpoint" class="text_pole fd-input"
                        placeholder="https://api.openai.com/v1" value="${_esc(s.extraApi.endpoint)}">
                </div>

                <!-- API Key -->
                <div class="fd-field-group">
                    <label class="fd-label" for="fd-api-key">
                        <i class="fa-solid fa-key"></i> API Key
                    </label>
                    <input type="password" id="fd-api-key" class="text_pole fd-input"
                        placeholder="sk-..." value="${_esc(s.extraApi.key)}">
                </div>

                <!-- Model -->
                <div class="fd-field-group">
                    <label class="fd-label" for="fd-model-select">
                        <i class="fa-solid fa-microchip"></i> Модель
                    </label>
                    <div class="fd-model-row">
                        <select id="fd-model-select" class="text_pole fd-select">
                            <option value="">— введи эндпоинт и нажми 🔄 —</option>
                        </select>
                        <button id="fd-refresh-models-btn" class="menu_button fd-icon-btn"
                            title="Обновить список моделей">
                            <i class="fa-solid fa-rotate"></i>
                        </button>
                    </div>
                </div>

                <!-- Context messages -->
                <div class="fd-field-group">
                    <label class="fd-label" for="fd-context-messages">
                        <i class="fa-solid fa-list"></i> Сообщений в контексте
                        <span class="fd-ctx-value">${s.extraApi.contextMessages ?? 10}</span>
                    </label>
                    <input type="range" id="fd-context-messages" class="fd-range-input"
                        min="2" max="40" step="1" value="${s.extraApi.contextMessages ?? 10}">
                    <small class="fd-label" style="opacity:0.5;margin-top:2px;">
                        Сколько последних сообщений чата передавать модели. Персонаж и персона передаются всегда.
                    </small>
                </div>

                <hr class="fd-divider">

                <!-- Options For -->
                <div class="fd-field-group">
                    <label class="fd-label">
                        <i class="fa-solid fa-users"></i> Генерировать варианты для
                    </label>
                    <div class="fd-radio-group" id="fd-options-for-group">
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-for" value="user" ${(s.optionsFor ?? 'user') === 'user' ? 'checked' : ''}>
                            <i class="fa-solid fa-user"></i> Юзера
                        </label>
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-for" value="all" ${(s.optionsFor ?? 'user') === 'all' ? 'checked' : ''}>
                            <i class="fa-solid fa-people-group"></i> Всех
                        </label>
                    </div>
                </div>

                <!-- Options Person -->
                <div class="fd-field-group">
                    <label class="fd-label">
                        <i class="fa-solid fa-comment"></i> Лицо повествования
                    </label>
                    <div class="fd-radio-group" id="fd-options-person-group">
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-person" value="first" ${(s.optionsPerson ?? 'second') === 'first' ? 'checked' : ''}>
                            1-е (я иду...)
                        </label>
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-person" value="second" ${(s.optionsPerson ?? 'second') === 'second' ? 'checked' : ''}>
                            2-е (ты идёшь...)
                        </label>
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-person" value="third" ${(s.optionsPerson ?? 'second') === 'third' ? 'checked' : ''}>
                            3-е (он/она идёт...)
                        </label>
                    </div>
                </div>

                <!-- Options Style -->
                <div class="fd-field-group">
                    <label class="fd-label">
                        <i class="fa-solid fa-layer-group"></i> Стиль вариантов
                    </label>
                    <div class="fd-radio-group" id="fd-options-style-group">
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-style" value="compact" ${(s.optionsStyle ?? 'compact') === 'compact' ? 'checked' : ''}>
                            <i class="fa-solid fa-align-justify"></i> Компактные
                        </label>
                        <label class="fd-radio-label">
                            <input type="radio" name="fd-options-style" value="expanded" ${(s.optionsStyle ?? 'compact') === 'expanded' ? 'checked' : ''}>
                            <i class="fa-solid fa-newspaper"></i> Развёрнутые
                        </label>
                    </div>
                    <small class="fd-label" style="opacity:0.5;margin-top:2px;">
                        Развёрнутые: заголовок + мини-пост 200–300 слов
                    </small>
                </div>

                <hr class="fd-divider">

                <!-- Prompt editor -->
                <div class="fd-field-group">
                    <label class="fd-label">
                        <i class="fa-solid fa-terminal"></i> Промпт для модели
                    </label>
                    <div class="fd-preset-toolbar">
                        <select id="fd-preset-select" class="text_pole fd-select fd-preset-select">
                            <option value="">— пресеты —</option>
                            ${s.presets.map((p, i) => `<option value="${i}">${_esc(p.name)}</option>`).join('')}
                        </select>
                        <button id="fd-preset-save-btn" class="menu_button fd-icon-btn" title="Сохранить как пресет">
                            <i class="fa-solid fa-floppy-disk"></i>
                        </button>
                        <button id="fd-preset-delete-btn" class="menu_button fd-icon-btn" title="Удалить пресет">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    <textarea id="fd-prompt-textarea" class="text_pole fd-prompt-textarea" rows="5"
                        placeholder="Промпт автоматически строится из настроек выше…">${_esc(s.customPrompt)}</textarea>
                    <div class="fd-prompt-footer">
                        <button id="fd-prompt-reset-btn" class="menu_button fd-icon-btn" title="Сбросить к авто">
                            <i class="fa-solid fa-rotate-left"></i> Авто
                        </button>
                        <small class="fd-label" style="opacity:0.45;">Редактируй вручную или сбрось к авто</small>
                    </div>
                </div>

                <hr class="fd-divider">

                <!-- Actions -->
                <div class="fd-actions">
                    <button id="fd-test-btn" class="menu_button">
                        <i class="fa-solid fa-plug"></i> Тест
                    </button>
                    <button id="fd-save-btn" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-floppy-disk"></i> Сохранить
                    </button>
                </div>

            </div>
        </div>
    </div>
</div>`;

    $('#extensions_settings').append(extSettingsHtml);

    // Wire events
    document.getElementById('fd-refresh-models-btn')?.addEventListener('click', refreshModels);
    document.getElementById('fd-test-btn')?.addEventListener('click', testConnection);
    document.getElementById('fd-save-btn')?.addEventListener('click', saveApiSettings);

    // Auto-save inputs on change
    ['fd-endpoint', 'fd-api-key'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            const s = getSettings();
            const epEl = document.getElementById('fd-endpoint');
            const keyEl = document.getElementById('fd-api-key');
            if (epEl) s.extraApi.endpoint = epEl.value.trim();
            if (keyEl) s.extraApi.key = keyEl.value.trim();
            saveSettingsDebounced();
        });
    });

    document.getElementById('fd-model-select')?.addEventListener('change', (e) => {
        getSettings().extraApi.model = e.target.value;
        saveSettingsDebounced();
    });

    // Context slider
    const ctxSlider = document.getElementById('fd-context-messages');
    const ctxLabel = document.querySelector('.fd-ctx-value');
    ctxSlider?.addEventListener('input', () => {
        const val = parseInt(ctxSlider.value);
        if (ctxLabel) ctxLabel.textContent = val;
        getSettings().extraApi.contextMessages = val;
        saveSettingsDebounced();
    });

    // Options For radios
    document.querySelectorAll('input[name="fd-options-for"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            getSettings().optionsFor = e.target.value;
            saveSettingsDebounced();
            _syncPromptTextarea();
        });
    });

    // Options Person radios
    document.querySelectorAll('input[name="fd-options-person"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            getSettings().optionsPerson = e.target.value;
            saveSettingsDebounced();
            _syncPromptTextarea();
        });
    });

    // Options Style radios
    document.querySelectorAll('input[name="fd-options-style"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            getSettings().optionsStyle = e.target.value;
            saveSettingsDebounced();
            _syncPromptTextarea();
        });
    });

    // Prompt textarea
    const promptTa = document.getElementById('fd-prompt-textarea');
    if (promptTa) {
        if (!getSettings().customPrompt) promptTa.value = _buildAutoDirective(getSettings());
        promptTa.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            const s = getSettings();
            s.customPrompt = (val === _buildAutoDirective(s) || val === '') ? '' : val;
            saveSettingsDebounced();
        });
    }
    // Reset prompt to auto
    document.getElementById('fd-prompt-reset-btn')?.addEventListener('click', () => {
        const s = getSettings();
        s.customPrompt = '';
        saveSettingsDebounced();
        _syncPromptTextarea();
        toastr.info('Промпт сброшен к авто', 'Fanfic Director');
    });
    // Save preset
    document.getElementById('fd-preset-save-btn')?.addEventListener('click', () => {
        const ta = document.getElementById('fd-prompt-textarea');
        const prompt = ta?.value?.trim() || '';
        if (!prompt) { toastr.warning('Промпт пустой', 'Fanfic Director'); return; }
        const name = window.prompt('Название пресета:');
        if (!name?.trim()) return;
        const s = getSettings();
        const idx = s.presets.findIndex(p => p.name === name.trim());
        if (idx >= 0) s.presets[idx] = { name: name.trim(), prompt };
        else s.presets.push({ name: name.trim(), prompt });
        saveSettingsDebounced();
        _syncPresetSelect();
        toastr.success(`✅ Пресет «${name.trim()}» сохранён`, 'Fanfic Director');
    });
    // Delete preset
    document.getElementById('fd-preset-delete-btn')?.addEventListener('click', () => {
        const sel = document.getElementById('fd-preset-select');
        const idx = parseInt(sel?.value);
        if (isNaN(idx)) { toastr.warning('Выбери пресет для удаления', 'Fanfic Director'); return; }
        const s = getSettings();
        const pName = s.presets[idx]?.name;
        s.presets.splice(idx, 1);
        saveSettingsDebounced();
        _syncPresetSelect();
        toastr.info(`Пресет «${pName}» удалён`, 'Fanfic Director');
    });
    // Load preset
    document.getElementById('fd-preset-select')?.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value);
        if (isNaN(idx)) return;
        const preset = getSettings().presets[idx];
        if (!preset) return;
        const ta = document.getElementById('fd-prompt-textarea');
        if (ta) ta.value = preset.prompt;
        getSettings().customPrompt = preset.prompt;
        saveSettingsDebounced();
    });

    // Populate model select if we have a saved model
    syncSettingsPanel();

    console.log('[FanficDirector] Extensions drawer UI ready');
}

// ───────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────
function _esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Returns a string key identifying the current chat (characterId + msgCount + last msg snippet). */
function _getChatKey() {
    try {
        const ctx = getContext();
        const last = ctx.chat?.[ctx.chat.length - 1];
        return `${ctx.characterId}__${ctx.chat?.length ?? 0}__${(last?.mes || '').slice(0, 50)}`;
    } catch { return ''; }
}

/** Re-fills the prompt textarea with the auto directive (if no custom prompt set). */
function _syncPromptTextarea() {
    const s = getSettings();
    if (s.customPrompt) return; // user has an override — don't touch it
    const ta = document.getElementById('fd-prompt-textarea');
    if (ta) ta.value = _buildAutoDirective(s);
}

/** Rebuilds the preset <select> from current settings. */
function _syncPresetSelect() {
    const sel = document.getElementById('fd-preset-select');
    if (!sel) return;
    const s = getSettings();
    sel.innerHTML = '<option value="">— пресеты —</option>';
    s.presets.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

/**
 * Auto-build the directive from current settings (ignoring customPrompt).
 */
function _buildAutoDirective(s) {
    const optFor    = s.optionsFor    ?? 'user';
    const optPerson = s.optionsPerson ?? 'second';
    const optStyle  = s.optionsStyle  ?? 'compact';

    const forMap = {
        user:      'the user (player character)',
        all:       'any character in the scene (could be the user, the AI character, or a side character)',
    };
    const forDesc = forMap[optFor] ?? forMap.user;

    const personMap = {
        first:  'Write each option in FIRST person (e.g., "I reach for the door…").',
        second: 'Write each option in SECOND person (e.g., "You reach for the door…").',
        third:  'Write each option in THIRD person (e.g., "He/She reaches for the door…").',
    };
    const personDesc = personMap[optPerson] ?? personMap.second;

    if (optStyle === 'expanded') {
        return (
            `IMPORTANT: Your response must be ONLY a raw JSON array of exactly 3 story option objects for ${forDesc}. ` +
            `Each object has exactly two fields: "title" (a short 5-10 word summary of the option) and "content" ` +
            `(a vivid 200-300 word narrative prose post — NOT a summary, write it as an actual in-world scene or action). ` +
            `${personDesc} ` +
            `No markdown, no explanation, ONLY the JSON array. ` +
            `Example: [{"title": "Confront him directly", "content": "You step forward and..."}, ...]`
        );
    }
    return (
        `IMPORTANT: Your response must be ONLY a raw JSON array of exactly 3 short story choices ` +
        `(15-25 words each) for ${forDesc}. ` +
        `${personDesc} ` +
        `No markdown, no explanation, ONLY the JSON array. ` +
        `Example: ["Choice A here", "Choice B here", "Choice C here"]`
    );
}

/**
 * Returns the directive to use: custom if set, otherwise auto-built.
 */
function _buildDirective(s) {
    if (s.customPrompt) return s.customPrompt;
    return _buildAutoDirective(s);
}

/**
 * Opens inline edit mode inside a compact option row.
 */
function _startInlineEdit(rowEl, initialText) {
    rowEl.innerHTML = '';
    rowEl.className = 'fd-option-row fd-option-row--editing';

    const ta = document.createElement('textarea');
    ta.className = 'fd-option-edit-ta';
    ta.value = initialText;
    ta.rows = 4;

    const actions = document.createElement('div');
    actions.className = 'fd-option-edit-actions';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'menu_button';
    sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Отправить';
    sendBtn.addEventListener('click', () => handleOptionClick(ta.value));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'menu_button';
    cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Отмена';
    cancelBtn.addEventListener('click', () => {
        rowEl.className = 'fd-option-row';
        rowEl.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'fd-option-btn';
        btn.textContent = initialText;
        btn.addEventListener('click', () => handleOptionClick(initialText));
        const editBtn = document.createElement('button');
        editBtn.className = 'fd-option-edit-btn';
        editBtn.title = 'Редактировать';
        editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
        editBtn.addEventListener('click', () => _startInlineEdit(rowEl, initialText));
        rowEl.appendChild(btn);
        rowEl.appendChild(editBtn);
    });

    actions.appendChild(sendBtn);
    actions.appendChild(cancelBtn);
    rowEl.appendChild(ta);
    rowEl.appendChild(actions);
    ta.focus();
}

/**
 * Build the context payload for Extra API calls.
 * Returns an array of {role, content} messages.
 */
function buildApiContext() {
    const s = getSettings();
    const ctx = getContext();
    const n = s.extraApi.contextMessages ?? 10;

    // Character card info
    const char = ctx.characters?.[ctx.characterId];
    let systemParts = [];

    if (char) {
        const charDesc = [
            char.name ? `Name: ${char.name}` : '',
            char.description ? `Description: ${char.description}` : '',
            char.personality ? `Personality: ${char.personality}` : '',
            char.mes_example ? `Example dialogue:\n${char.mes_example.slice(0, 800)}` : '',
        ].filter(Boolean).join('\n');
        if (charDesc) systemParts.push(`[Character]\n${charDesc}`);
    }

    // Persona info
    const personaName = ctx.name1 || 'User';
    const personaDesc = ctx.persona || '';
    const personaSpeech = s.personaSpeechMap?.[personaName] || s.personaSpeechMap?.['Default'] || '';
    let personaParts = [`Persona name: ${personaName}`];
    if (personaDesc) personaParts.push(`Persona description: ${personaDesc}`);
    if (personaSpeech) personaParts.push(`Speech examples:\n${personaSpeech}`);
    systemParts.push(`[User Persona]\n${personaParts.join('\n')}`);

    const systemContent = systemParts.join('\n\n');

    // Recent chat history
    const recentChat = (ctx.chat || []).slice(-n).map(m => ({
        role: m.is_user ? 'user' : 'assistant',
        content: m.mes || '',
    }));

    const messages = [];
    if (systemContent) messages.push({ role: 'system', content: systemContent });
    messages.push(...recentChat);

    return messages;
}

// ═══════════════════════════════════════════════════════
// ── OPTIONS GENERATION (after each AI message) ──────────
// ═══════════════════════════════════════════════════════

const FD_OPTIONS_ID = 'fd-options-block';
const FD_GEN_BTN_ID = 'fd-generate-btn';

let _isGeneratingOptions = false;
let _isChatLoading = false;
let _chatLoadingTimer = null;
let _loadingInterval = null;
/** true after user has clicked Generate Options at least once (this session/chat) */
let _optionsActivated = false;

function removeOptionsBlock() {
    document.getElementById(FD_OPTIONS_ID)?.remove();
}

function removeGenerateButton() {
    document.getElementById(FD_GEN_BTN_ID)?.remove();
}

function showOptionsLoading() {
    removeOptionsBlock();
    const chat = document.getElementById('chat');
    if (!chat) return;

    const block = document.createElement('div');
    block.id = FD_OPTIONS_ID;
    block.className = 'fd-options-block';

    const loader = document.createElement('div');
    loader.className = 'fd-options-loader';

    const dot = document.createElement('span');
    dot.className = 'fd-loader-dots';
    dot.textContent = '⬡';

    const text = document.createElement('span');
    text.className = 'fd-loader-text';
    text.textContent = 'Generating choices';

    const dotsEl = document.createElement('span');
    dotsEl.className = 'fd-loader-animated-dots';

    loader.appendChild(dot);
    loader.appendChild(text);
    loader.appendChild(dotsEl);
    block.appendChild(loader);
    chat.appendChild(block);

    requestAnimationFrame(() => requestAnimationFrame(() => block.classList.add('fd-options-visible')));
    block.scrollIntoView({ behavior: 'smooth', block: 'end' });

    const dotStates = ['.', '..', '...'];
    let dotIdx = 0;
    dotsEl.textContent = dotStates[0];
    _loadingInterval = setInterval(() => {
        dotIdx = (dotIdx + 1) % dotStates.length;
        dotsEl.textContent = dotStates[dotIdx];
    }, 500);
}

function stopOptionsLoading() {
    if (_loadingInterval) { clearInterval(_loadingInterval); _loadingInterval = null; }
}

/** Build the shared options-block header (label + regen button). */
function _buildOptionsHeader() {
    const header = document.createElement('div');
    header.className = 'fd-options-header';

    const label = document.createElement('div');
    label.className = 'fd-options-label';
    label.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Выбери путь';

    const regenBtn = document.createElement('button');
    regenBtn.className = 'fd-regen-btn';
    regenBtn.title = 'Перегенерировать';
    regenBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    regenBtn.addEventListener('click', () => { removeOptionsBlock(); generateOptions(); });

    header.appendChild(label);
    header.appendChild(regenBtn);
    return header;
}

function showOptionButtons(options, styleOverride = null) {
    stopOptionsLoading();
    removeOptionsBlock();

    const effectiveStyle = styleOverride ?? getSettings().optionsStyle;
    if (effectiveStyle === 'expanded') {
        showExpandedOptionCards(options);
        return;
    }

    const chat = document.getElementById('chat');
    if (!chat || !options.length) return;

    const block = document.createElement('div');
    block.id = FD_OPTIONS_ID;
    block.className = 'fd-options-block';
    block.appendChild(_buildOptionsHeader());

    const grid = document.createElement('div');
    grid.className = 'fd-options-grid';

    options.forEach((optText, i) => {
        const text = typeof optText === 'object' ? (optText.title || optText.content || String(optText)) : String(optText);

        const row = document.createElement('div');
        row.className = 'fd-option-row';

        const btn = document.createElement('button');
        btn.className = 'fd-option-btn';
        btn.dataset.index = String(i);
        btn.textContent = text;
        btn.addEventListener('click', () => handleOptionClick(text));

        const editBtn = document.createElement('button');
        editBtn.className = 'fd-option-edit-btn';
        editBtn.title = 'Редактировать перед отправкой';
        editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
        editBtn.addEventListener('click', () => _startInlineEdit(row, text));

        row.appendChild(btn);
        row.appendChild(editBtn);
        grid.appendChild(row);
    });

    block.appendChild(grid);
    chat.appendChild(block);

    requestAnimationFrame(() => block.classList.add('fd-options-visible'));
    block.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function showExpandedOptionCards(options) {
    const chat = document.getElementById('chat');
    if (!chat || !options.length) return;

    const block = document.createElement('div');
    block.id = FD_OPTIONS_ID;
    block.className = 'fd-options-block';
    block.appendChild(_buildOptionsHeader());

    const grid = document.createElement('div');
    grid.className = 'fd-options-grid fd-options-grid--expanded';

    options.forEach((opt, i) => {
        const title   = typeof opt === 'object' ? (opt.title   || `Вариант ${i + 1}`) : `Вариант ${i + 1}`;
        const content = typeof opt === 'object' ? (opt.content || String(opt))       : String(opt);

        const card = document.createElement('div');
        card.className = 'fd-option-card';
        card.dataset.index = String(i);

        const titleEl = document.createElement('div');
        titleEl.className = 'fd-option-card__title';
        titleEl.textContent = title;

        const bodyEl = document.createElement('div');
        bodyEl.className = 'fd-option-card__body';
        bodyEl.textContent = content;

        const cardFooter = document.createElement('div');
        cardFooter.className = 'fd-option-card__footer';

        const editBtn = document.createElement('button');
        editBtn.className = 'fd-option-card__edit';
        editBtn.title = 'Редактировать';
        editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
        let isEditing = false;
        editBtn.addEventListener('click', () => {
            isEditing = !isEditing;
            bodyEl.contentEditable = isEditing ? 'true' : 'false';
            bodyEl.classList.toggle('fd-option-card__body--editing', isEditing);
            editBtn.classList.toggle('fd-option-card__edit--active', isEditing);
            if (isEditing) { bodyEl.focus(); }
        });

        const btnEl = document.createElement('button');
        btnEl.className = 'fd-option-card__choose';
        btnEl.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Отправить';
        btnEl.addEventListener('click', () => handleOptionClick(bodyEl.textContent || content));

        cardFooter.appendChild(editBtn);
        cardFooter.appendChild(btnEl);

        card.appendChild(titleEl);
        card.appendChild(bodyEl);
        card.appendChild(cardFooter);
        grid.appendChild(card);
    });

    block.appendChild(grid);
    chat.appendChild(block);

    requestAnimationFrame(() => block.classList.add('fd-options-visible'));
    block.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function handleOptionClick(text) {
    removeOptionsBlock();
    try {
        const sendInput = document.getElementById('send_textarea');
        if (sendInput) {
            sendInput.value = text;
            sendInput.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(() => document.getElementById('send_but')?.click(), 50);
        }
    } catch (err) {
        console.error('[FanficDirector] handleOptionClick error:', err);
        toastr.error('Ошибка отправки выбора', 'Fanfic Director');
    }
}

async function generateOptions() {
    const s = getSettings();
    if (!s.extraApi.endpoint || !s.extraApi.key) return;
    if (_isGeneratingOptions) return;
    _isGeneratingOptions = true;

    showOptionsLoading();

    const endpoint = s.extraApi.endpoint.replace(/\/+$/, '');
    const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;

    try {
        // buildApiContext() returns [system?, ...chat_history]
        const contextMessages = buildApiContext();

        // Put directive in system message — avoids consecutive user messages
        const directive = _buildDirective(s);

        let messages;
        if (contextMessages.length > 0 && contextMessages[0].role === 'system') {
            messages = [
                { role: 'system', content: contextMessages[0].content + '\n\n' + directive },
                ...contextMessages.slice(1),
            ];
        } else {
            messages = [{ role: 'system', content: directive }, ...contextMessages];
        }

        // Always end with a user message (required by some APIs)
        if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
            messages.push({ role: 'user', content: 'Generate 3 story choices for my next action.' });
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${s.extraApi.key}`,
            },
            body: JSON.stringify({
                model: s.extraApi.model || 'gpt-3.5-turbo',
                messages,
                max_tokens: 60000,
                temperature: 0.9,
            }),
        });

        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 100)}`);
        }

        const data = await resp.json();
        let raw = data?.choices?.[0]?.message?.content?.trim() || '';
        if (!raw) throw new Error('Empty response from API');

        console.log('[FanficDirector] Raw options response:', raw);

        // ── Robust JSON extraction ──────────────
        // 1. Strip markdown fences
        raw = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

        // 1b. Replace literal newlines/carriage returns with a space
        //     (models sometimes put real \n inside JSON string values, making it invalid JSON)
        raw = raw.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');

        // 2. Direct parse
        let options = null;
        try { options = JSON.parse(raw); } catch { /* fall through */ }

        // 3. Extract first [...] block and try again
        if (!Array.isArray(options)) {
            const startIdx = raw.indexOf('[');
            if (startIdx !== -1) {
                let chunk = raw.slice(startIdx);
                const endIdx = chunk.lastIndexOf(']');
                if (endIdx !== -1) {
                    // Complete array found — try parse as-is
                    try { options = JSON.parse(chunk.slice(0, endIdx + 1)); } catch { /* fall through */ }
                }
                // 3b. Array truncated (no closing ']') — attempt repair
                if (!Array.isArray(options)) {
                    // Close any unclosed string, then close the array
                    let repairable = endIdx !== -1 ? chunk.slice(0, endIdx + 1) : chunk;
                    // Count unmatched quotes to detect open string
                    const quoteCount = (repairable.match(/(?<!\\)"/g) || []).length;
                    if (quoteCount % 2 !== 0) repairable += '"'; // close open string
                    repairable = repairable.replace(/,\s*$/, '') + ']'; // close array
                    try { options = JSON.parse(repairable); } catch { /* fall through */ }
                }
            }
        }

        // 4. Quoted strings fallback — works even with newlines already collapsed
        if (!Array.isArray(options) || !options.length) {
            const quoted = [...raw.matchAll(/"([\s\S]{10,300})"/g)].map(m => m[1].trim()).filter(s => s.length >= 5);
            if (quoted.length >= 2) options = quoted;
        }

        if (!Array.isArray(options) || !options.length) {
            console.warn('[FanficDirector] Full raw response:', raw);
            throw new Error('Could not parse options from response');
        }


        const finalOptions = options.slice(0, 4);
        // Persist so they survive chat reload
        try {
            const chatKey = _getChatKey();
            if (chatKey) {
                getSettings().lastOptions = { chatKey, options: finalOptions, style: getSettings().optionsStyle };
                saveSettingsDebounced();
            }
        } catch(e) { /* ignore */ }
        showOptionButtons(finalOptions);

    } catch (err) {
        console.error('[FanficDirector] generateOptions error:', err);
        stopOptionsLoading();
        removeOptionsBlock();
        toastr.error(`Options error: ${err.message}`, 'Fanfic Director');
        // Show button so user can retry manually
        showGenerateButton();
    } finally {
        _isGeneratingOptions = false;
    }
}

function showGenerateButton() {
    const s = getSettings();
    if (!s.extraApi.endpoint || !s.extraApi.key) return;

    removeGenerateButton();
    removeOptionsBlock();

    const chat = document.getElementById('chat');
    if (!chat) return;

    const allMsgs = chat.querySelectorAll('.mes');
    let lastBotMsg = null;
    for (let i = allMsgs.length - 1; i >= 0; i--) {
        if (!allMsgs[i].classList.contains('is_user')) {
            lastBotMsg = allMsgs[i];
            break;
        }
    }
    if (!lastBotMsg) return;

    const btn = document.createElement('button');
    btn.id = FD_GEN_BTN_ID;
    btn.className = 'fd-generate-btn menu_button';
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Options';
    btn.addEventListener('click', () => {
        removeGenerateButton();
        _optionsActivated = true;  // from now on: auto-generate
        generateOptions();
    });

    lastBotMsg.insertAdjacentElement('afterend', btn);
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function initOptionsSystem() {
    // Remove options/button when user sends
    eventSource.on(event_types.MESSAGE_SENT, () => {
        removeOptionsBlock();
        removeGenerateButton();
    });

    // After new AI message — auto-generate if activated, else show button
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        if (_isChatLoading) return;
        const s = getSettings();
        if (!s.extraApi.endpoint || !s.extraApi.key) return;
        if (_optionsActivated) {
            setTimeout(generateOptions, 300);
        } else {
            setTimeout(showGenerateButton, 300);
        }
    });

    // Chat changed/loaded: set loading flag, then show button when settled
    const onChatReady = () => {
        _optionsActivated = false;  // reset on chat change — show button again first
        _isChatLoading = true;
        clearTimeout(_chatLoadingTimer);
        removeOptionsBlock();
        removeGenerateButton();

        _chatLoadingTimer = setTimeout(() => {
            _isChatLoading = false;
            // Try to restore last options for this chat
            try {
                const s = getSettings();
                const key = _getChatKey();
                if (key && s.lastOptions && s.lastOptions.chatKey === key && s.lastOptions.options?.length) {
                    showOptionButtons(s.lastOptions.options, s.lastOptions.style);
                    return;
                }
            } catch(e) { /* ignore */ }
            showGenerateButton();
        }, 1500);
    };

    eventSource.on(event_types.CHAT_CHANGED, onChatReady);
    eventSource.on(event_types.CHAT_LOADED, onChatReady);

    console.log('[FanficDirector] Options system ready');
}

// ───────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────
jQuery(async () => {
    try {
        console.log('[FanficDirector] Loading...');
        loadSettings();
        initOptionsSystem();

        // Register {{personaspeech}} macro
        registerPersonaSpeechMacro();

        // Inject persona speech field into ST's persona panel (when it appears)
        injectPersonaSpeechField();

        // Also try to inject when persona management panel opens
        // ST uses a button that shows #persona-management-block, we observe it
        const observer = new MutationObserver(() => {
            if (!document.getElementById('fd-persona-speech-field')) {
                injectPersonaSpeechField();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Re-sync speech textarea when persona changes
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(() => _syncPersonaSpeechTextarea(), 500);
        });

        // Retry until #extensions_settings exists
        let attempts = 0;
        const trySetup = () => {
            if (document.getElementById('extensions_settings')) {
                setupUI();
            } else if (attempts < 15) {
                attempts++;
                setTimeout(trySetup, 400);
            } else {
                console.warn('[FanficDirector] Could not find #extensions_settings');
            }
        };
        setTimeout(trySetup, 300);

        console.log('[FanficDirector] Ready');
    } catch (err) {
        console.error('[FanficDirector] Fatal error:', err);
    }
});
