// ── Settings Modal & localStorage Config ──

const CONFIG_KEY = 'research_network_config';

const DEFAULTS = {
    scholarId: '',
    researcherName: '',
    scrapeMethod: 'selenium',
    scraperKey: '',
    seleniumUrl: 'http://localhost:5555',
    llmProvider: 'openai',
    llmKey: '',
    llmModel: '',
};

export function loadConfig() {
    try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    return { ...DEFAULTS };
}

export function saveConfig(cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function validateConfig(cfg) {
    const missing = [];
    if (!cfg.scholarId.trim()) missing.push('Scholar ID');
    if (!cfg.researcherName.trim()) missing.push('Researcher Name');
    if (cfg.scrapeMethod === 'scraperapi' && !cfg.scraperKey.trim()) missing.push('ScraperAPI Key');
    return missing;
}

export function initSettingsModal() {
    const modal = document.getElementById('settingsModal');
    const btnOpen = document.getElementById('btnSettings');
    const btnClose = document.getElementById('btnCloseSettings');
    const btnCancel = document.getElementById('btnCancelSettings');
    const btnSave = document.getElementById('btnSaveSettings');

    const fields = {
        scholarId: document.getElementById('cfgScholarId'),
        researcherName: document.getElementById('cfgResearcherName'),
        scrapeMethod: document.getElementById('cfgScrapeMethod'),
        scraperKey: document.getElementById('cfgScraperKey'),
        seleniumUrl: document.getElementById('cfgSeleniumUrl'),
        llmProvider: document.getElementById('cfgLlmProvider'),
        llmKey: document.getElementById('cfgLlmKey'),
        llmModel: document.getElementById('cfgLlmModel'),
    };

    const scraperKeyGroup = document.getElementById('scraperKeyGroup');
    const seleniumUrlGroup = document.getElementById('seleniumUrlGroup');
    const scrapeMethodHint = document.getElementById('scrapeMethodHint');

    function updateMethodVisibility() {
        const method = fields.scrapeMethod.value;
        if (method === 'selenium') {
            scraperKeyGroup.style.display = 'none';
            seleniumUrlGroup.style.display = 'block';
            scrapeMethodHint.textContent = 'Run "python scraper/server.py" locally first';
        } else {
            scraperKeyGroup.style.display = 'block';
            seleniumUrlGroup.style.display = 'none';
            scrapeMethodHint.textContent = 'Uses ScraperAPI cloud proxy';
        }
    }

    fields.scrapeMethod.addEventListener('change', updateMethodVisibility);

    function populateFields() {
        const cfg = loadConfig();
        for (const [key, el] of Object.entries(fields)) {
            el.value = cfg[key] || '';
        }
        updateMethodVisibility();
    }

    function openModal() {
        populateFields();
        modal.style.display = 'flex';
    }

    function closeModal() {
        modal.style.display = 'none';
    }

    btnOpen.addEventListener('click', openModal);
    btnClose.addEventListener('click', closeModal);
    btnCancel.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    btnSave.addEventListener('click', () => {
        const cfg = {};
        for (const [key, el] of Object.entries(fields)) {
            cfg[key] = el.value.trim();
        }
        saveConfig(cfg);
        closeModal();
    });

    // Auto-open if no config is set
    const cfg = loadConfig();
    if (!cfg.scholarId) {
        setTimeout(openModal, 300);
    }
}
