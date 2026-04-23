(() => {
	'use strict';

	// --- Constants ---

	const DEFAULT_START_SPEAKING_MESSAGE_DELAY = 200;
	const DEFAULT_LISTENING_MESSAGE_DELAY = 600;
	const DEFAULT_PHRASE_DELAY = 1000;
	const DEFAULT_LANGUAGE = 'malayalam';
	const APPCONFIG_QUERY_KEY = 'dummy_voice_config_json';
	const STATE_STORAGE_KEY = 'dummy_voice_config_state';
	const LANGUAGE_STORAGE_KEY = 'dummy_voice_config_language';
	const STATE_VERSION = 2;

	const MODES = [
		{ key: 'native', label: 'Native' },
		{ key: 'english', label: 'English' },
		{ key: 'romanized', label: 'Romanized' },
	];

	// Mirrors KeyboardFlavors.kt — keep in sync if a flavor is added/renamed.
	const LANGUAGES = [
		'malayalam', 'hindi', 'amharic', 'bangla', 'chinese', 'gujarati',
		'japanese', 'kannada', 'marathi', 'nepali', 'odia', 'punjabi',
		'russian', 'sanskrit', 'sinhala', 'tamil', 'telugu', 'tigrinya',
		'urdu', 'vietnamese', 'arabic',
	];

	// --- State ---

	function makeDefaultModeState() {
		return {
			startSpeakingMessageDelay: DEFAULT_START_SPEAKING_MESSAGE_DELAY,
			listeningMessageDelay: DEFAULT_LISTENING_MESSAGE_DELAY,
			phrases: [{ delay: DEFAULT_PHRASE_DELAY, fieldText: '' }],
		};
	}

	// Modes only — language lives in its own variable because it's always valid
	// (any unknown value falls back to DEFAULT_LANGUAGE) and round-trips separately.
	const state = {};
	MODES.forEach(m => { state[m.key] = makeDefaultModeState(); });

	let language = DEFAULT_LANGUAGE;

	// --- DOM refs ---

	const modesContainer = document.getElementById('modes');
	const jsonOutput = document.getElementById('json-output');
	const languageSelect = document.getElementById('language');
	const errorsContainer = document.getElementById('errors-container');
	const errorsList = document.getElementById('errors-list');
	const outputPanel = document.getElementById('output-panel');
	const settingsModal = document.getElementById('settings-modal');
	const settingsTitle = document.getElementById('settings-title');
	const settingsStartSpeakingInput = document.getElementById('settings-start-speaking');
	const settingsListeningInput = document.getElementById('settings-listening');
	const outputStatus = document.getElementById('output-status');

	// --- DOM helpers ---

	function el(tag, attrs, children) {
		const node = document.createElement(tag);
		if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
		if (children) for (const c of children) {
			node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
		}
		return node;
	}

	function materialIcon(name) {
		return el('span', { class: 'material-icons' }, [name]);
	}

	function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

	// --- Persistence with versioned migrations ---
	// To introduce a new schema version: bump STATE_VERSION and add a migrator
	// at MIGRATIONS[previousVersion] that returns the next-version shape.
	// Omitting a step for a version the loader encounters is a hard fail —
	// the stored state is discarded and defaults are used.

	const MIGRATIONS = {
		// v1 kept `language` inside the state blob; v2 stores it separately.
		1: (s) => { const { language: _, ...rest } = s; return rest; },
	};

	function migrate(raw) {
		let cur = typeof raw.version === 'number' ? raw.version : 1;
		let out = raw;
		while (cur < STATE_VERSION) {
			const step = MIGRATIONS[cur];
			if (!step) return null;
			out = step(out);
			cur += 1;
		}
		out.version = STATE_VERSION;
		return out;
	}

	function shapeOK(s) {
		if (!s || typeof s !== 'object') return false;
		for (const mode of MODES) {
			const m = s[mode.key];
			if (!m || typeof m !== 'object') return false;
			if (typeof m.startSpeakingMessageDelay !== 'number') return false;
			if (typeof m.listeningMessageDelay !== 'number') return false;
			if (!Array.isArray(m.phrases) || m.phrases.length === 0) return false;
			for (const p of m.phrases) {
				if (!p || typeof p !== 'object') return false;
				if (typeof p.delay !== 'number') return false;
				if (typeof p.fieldText !== 'string') return false;
			}
		}
		return true;
	}

	function saveState() {
		// Only persist validated states — invalid intermediates (blank text, NaN
		// delays) are dropped so the last good snapshot survives a refresh.
		if (validate().length > 0) return;
		try {
			const payload = { ...state, version: STATE_VERSION };
			localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
		} catch (e) {
			// Storage unavailable or quota exceeded — skip.
		}
	}

	function loadState() {
		let parsed;
		try {
			const raw = localStorage.getItem(STATE_STORAGE_KEY);
			if (!raw) return;
			parsed = JSON.parse(raw);
		} catch (e) {
			return;
		}
		if (!parsed || typeof parsed !== 'object') return;
		const migrated = migrate(parsed);
		if (!migrated || !shapeOK(migrated)) return;

		MODES.forEach(mode => {
			const m = migrated[mode.key];
			state[mode.key] = {
				startSpeakingMessageDelay: m.startSpeakingMessageDelay,
				listeningMessageDelay: m.listeningMessageDelay,
				phrases: m.phrases.map(p => ({ delay: p.delay, fieldText: p.fieldText })),
			};
		});
	}

	function saveLanguage() {
		try {
			localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
		} catch (e) {
			// Storage unavailable or quota exceeded — skip.
		}
	}

	function loadLanguage() {
		try {
			const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
			if (raw && LANGUAGES.includes(raw)) language = raw;
		} catch (e) {
			// Storage unavailable — keep default.
		}
	}

	// --- Validation ---

	function validate() {
		const errors = [];
		MODES.forEach(mode => {
			const s = state[mode.key];
			if (!Number.isFinite(s.startSpeakingMessageDelay) || s.startSpeakingMessageDelay < 0) {
				errors.push(`${mode.label}: start-speaking message delay must be 0 or more.`);
			}
			if (!Number.isFinite(s.listeningMessageDelay) || s.listeningMessageDelay < 0) {
				errors.push(`${mode.label}: listening message delay must be 0 or more.`);
			}
			s.phrases.forEach((p, i) => {
				if (!p.fieldText || p.fieldText.trim().length === 0) {
					errors.push(`${mode.label}: phrase #${i + 1} text cannot be empty.`);
				}
				if (!Number.isFinite(p.delay) || p.delay < 0) {
					errors.push(`${mode.label}: phrase #${i + 1} duration must be 0 or more.`);
				}
			});
		});
		return errors;
	}

	// --- Build output ---

	function buildJsonObject() {
		const out = {};
		MODES.forEach(mode => {
			const s = state[mode.key];
			out[mode.key] = {
				start_speaking_message_delay: s.startSpeakingMessageDelay,
				listening_message_delay: s.listeningMessageDelay,
				phrases: s.phrases.map(p => ({ delay: p.delay, field_text: p.fieldText })),
			};
		});
		return out;
	}

	function buildAppConfigUrl() {
		const json = JSON.stringify(buildJsonObject());
		const flavor = encodeURIComponent(language);
		return `https://desh.app/${flavor}/appconfig?${APPCONFIG_QUERY_KEY}=${encodeURIComponent(json)}`;
	}

	// --- Render ---

	function render() {
		modesContainer.innerHTML = '';
		MODES.forEach(mode => modesContainer.appendChild(renderMode(mode)));
		refresh();
	}

	function renderMode(mode) {
		const s = state[mode.key];
		const panel = el('div', { class: 'panel' });

		const settingsBtn = el('button', {
			class: 'settings-icon',
			type: 'button',
			title: 'Delay settings',
			'aria-label': `${mode.label} delay settings`,
		}, [materialIcon('settings')]);
		settingsBtn.addEventListener('click', () => openSettingsDialog(mode));

		panel.appendChild(el('div', { class: 'panel-header' }, [
			el('h2', {}, [mode.label]),
			settingsBtn,
		]));

		panel.appendChild(el('div', { class: 'phrases-subtitle' }, ['Phrases']));
		panel.appendChild(el('div', { class: 'phrase-header' }, [
			el('span', {}, ['Duration (ms)']),
			el('span', {}, ['Text']),
			el('span', {}, []),
		]));

		const list = el('div', {});
		s.phrases.forEach(p => list.appendChild(renderPhraseRow(mode.key, p)));
		panel.appendChild(list);

		const addBtn = el('button', { class: 'add-btn', type: 'button' }, ['+ Add phrase']);
		addBtn.addEventListener('click', () => {
			const p = { delay: DEFAULT_PHRASE_DELAY, fieldText: '' };
			s.phrases.push(p);
			list.appendChild(renderPhraseRow(mode.key, p));
			refresh();
		});
		panel.appendChild(addBtn);

		return panel;
	}

	function renderPhraseRow(modeKey, p) {
		const s = state[modeKey];
		const row = el('div', { class: 'phrase-row' });

		const delayInput = el('input', {
			type: 'number', min: '0',
			value: String(p.delay),
			placeholder: 'Time before showing this phrase',
			title: 'Time before showing this phrase (ms)',
		});
		delayInput.addEventListener('input', () => {
			const v = parseInt(delayInput.value, 10);
			p.delay = Number.isFinite(v) ? v : NaN;
			refresh();
		});
		row.appendChild(delayInput);

		const textInput = el('input', {
			type: 'text',
			value: p.fieldText,
			placeholder: 'What appears in the text field',
			title: 'Text that appears as a partial result',
		});
		textInput.addEventListener('input', () => {
			p.fieldText = textInput.value;
			refresh();
		});
		row.appendChild(textInput);

		const removeBtn = el('button', { class: 'danger-icon', type: 'button', title: 'Remove phrase' }, ['✕']);
		removeBtn.addEventListener('click', () => {
			if (s.phrases.length === 1) {
				// Always keep at least one phrase row — reset in place instead of deleting.
				p.delay = DEFAULT_PHRASE_DELAY;
				p.fieldText = '';
				delayInput.value = String(DEFAULT_PHRASE_DELAY);
				textInput.value = '';
			} else {
				const idx = s.phrases.indexOf(p);
				if (idx >= 0) s.phrases.splice(idx, 1);
				row.remove();
			}
			refresh();
		});
		row.appendChild(removeBtn);

		return row;
	}

	function refresh() {
		saveState();
		const errors = validate();
		if (errors.length > 0) {
			errorsList.innerHTML = '';
			errors.forEach(e => errorsList.appendChild(el('li', {}, [e])));
			errorsContainer.classList.remove('hidden');
			outputPanel.classList.add('hidden');
			return;
		}
		errorsContainer.classList.add('hidden');
		outputPanel.classList.remove('hidden');
		jsonOutput.value = JSON.stringify(buildJsonObject(), null, 2);
	}

	// --- Settings modal ---

	let settingsModeKey = null;

	function openSettingsDialog(mode) {
		settingsModeKey = mode.key;
		const s = state[mode.key];
		settingsTitle.textContent = `${mode.label} delay settings`;
		settingsStartSpeakingInput.value = Number.isFinite(s.startSpeakingMessageDelay) ? String(s.startSpeakingMessageDelay) : '';
		settingsListeningInput.value = Number.isFinite(s.listeningMessageDelay) ? String(s.listeningMessageDelay) : '';
		settingsModal.classList.remove('hidden');
		settingsStartSpeakingInput.focus();
	}

	function closeSettingsDialog() {
		settingsModal.classList.add('hidden');
		settingsModeKey = null;
	}

	function applySettingsDialog() {
		if (!settingsModeKey) return;
		const s = state[settingsModeKey];
		const startV = parseInt(settingsStartSpeakingInput.value, 10);
		const listenV = parseInt(settingsListeningInput.value, 10);
		s.startSpeakingMessageDelay = Number.isFinite(startV) ? startV : NaN;
		s.listeningMessageDelay = Number.isFinite(listenV) ? listenV : NaN;
		closeSettingsDialog();
		refresh();
	}

	document.getElementById('settings-ok').addEventListener('click', applySettingsDialog);
	document.getElementById('settings-cancel').addEventListener('click', closeSettingsDialog);
	settingsModal.addEventListener('click', (e) => {
		if (e.target === settingsModal) closeSettingsDialog();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) closeSettingsDialog();
	});

	// --- Copy / launch ---

	function showStatus(text, isError) {
		outputStatus.textContent = text;
		outputStatus.classList.toggle('error', !!isError);
		outputStatus.classList.add('visible');
		clearTimeout(outputStatus._timer);
		outputStatus._timer = setTimeout(() => outputStatus.classList.remove('visible'), 2500);
	}

	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			showStatus('Copied', false);
		} catch (e) {
			showStatus('Copy failed', true);
		}
	}

	document.getElementById('copy-json').addEventListener('click', () => copyText(jsonOutput.value));
	document.getElementById('copy-link').addEventListener('click', () => copyText(buildAppConfigUrl()));
	document.getElementById('set-appconfig').addEventListener('click', () => {
		window.open(buildAppConfigUrl(), '_blank', 'noopener');
	});

	// --- Init ---

	function populateLanguages() {
		LANGUAGES.forEach(lang => {
			languageSelect.appendChild(el('option', { value: lang }, [capitalize(lang)]));
		});
		languageSelect.addEventListener('change', () => {
			language = languageSelect.value;
			saveLanguage();
			refresh();
		});
	}

	loadState();
	loadLanguage();

	// URL ?language= overrides stored language — explicit intent from the link wins.
	// Any unrecognized value is ignored silently (falls back to stored/default).
	const urlLang = new URLSearchParams(window.location.search).get('language');
	if (urlLang && LANGUAGES.includes(urlLang)) {
		language = urlLang;
		saveLanguage();
	}

	populateLanguages();
	languageSelect.value = language;
	render();
})();
