// ── Main Application Entry ──

import { loadConfig, validateConfig, initSettingsModal } from './config.js';
import { parseCoAuthors, parseCitingAuthors } from './scholar.js';
import { exportNetworkJSON, importNetworkJSON } from './cache.js';
import { buildNetwork, filterNetwork, computeStats } from './network.js';
import { initGraph, renderGraph, destroyGraph } from './graph.js';
import { analyzePapers, extractCitationGeo, cleanInstitutions } from './llm.js';
import { aggregateGeoData, buildGeoFromProfiles, initGlobe, destroyGlobe } from './globe.js';
import { renderScholarView } from './scholar-view.js';

// ── State ──
let currentPublications = [];
let currentNetwork = null;
let cachedImportData = null;
let currentGeoData = null;   // raw { "pubIdx_citIdx": { country, institution } }
let currentLlmGeoData = {};  // base LLM geo data (first-author keyed, pi_ci format)
let currentGlobePoints = null; // aggregated points for globe
let currentGlobeStats = null;
let currentThemes = {};      // { pubTitle: { theme, color } }
let currentSummaries = {};   // { pubTitle: summary }
let currentAuthorCitations = {}; // { authorName: totalCitations }
let currentScholarProfiles = {}; // { scholarId: { fullName, totalCitations, institution } }
let currentProfileInfo = {};     // { coauthors: [{ name, affiliation, scholarId }] }
let currentResearcherName = '';  // from snapshot or config
let currentView = 'network'; // 'network' | 'globe'

// ── DOM Refs ──
const graphContainer = document.getElementById('graphContainer');
const globeWrapper = document.getElementById('globeWrapper');
const globeContainer = document.getElementById('globeContainer');
const emptyState = document.getElementById('emptyState');
const globeEmpty = document.getElementById('globeEmpty');
const rankingsSection = document.getElementById('rankingsSection');
const scholarContainer = document.getElementById('scholarContainer');
const scholarEmpty = document.getElementById('scholarEmpty');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const loadingDetail = document.getElementById('loadingDetail');
const progressFill = document.getElementById('progressFill');
const tooltip = document.getElementById('tooltip');

const btnRefresh = document.getElementById('btnRefresh');
const btnExport = document.getElementById('btnExport');
const btnImport = document.getElementById('btnImport');

const btnApplyFilter = document.getElementById('btnApplyFilter');
const btnClearFilter = document.getElementById('btnClearFilter');
const filterYearFrom = document.getElementById('filterYearFrom');
const filterYearTo = document.getElementById('filterYearTo');
const filterTopKMode = document.getElementById('filterTopKMode');
const filterTopKValue = document.getElementById('filterTopKValue');
const filterSearch = document.getElementById('filterSearch');

const filterShowCitations = document.getElementById('filterShowCitations');
const viewToggle = document.getElementById('viewToggle');
const authorModeSelect = document.getElementById('authorMode');

// ── Init ──
initSettingsModal();
initGraph(graphContainer);
autoLoadSnapshot();

// ── Auto-load snapshot from data/network.json ──
async function autoLoadSnapshot() {
    try {
        const resp = await fetch('data/network.json');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.publications || data.publications.length === 0) return;

        currentPublications = data.publications;
        updateStats(currentPublications);

        // Restore themes, summaries, author citations, and scholar profiles
        const themes = data.themes || {};
        const summaries = data.summaries || {};
        if (data.authorCitations) currentAuthorCitations = data.authorCitations;
        if (data.scholarProfiles) currentScholarProfiles = data.scholarProfiles;
        if (data.profileInfo) currentProfileInfo = data.profileInfo;

        // Store base LLM geo data (filtered to valid keys)
        const llmGeo = data.geoData || {};
        const validKeys = new Set();
        for (let pi = 0; pi < currentPublications.length; pi++) {
            for (let ci = 0; ci < (currentPublications[pi].citations || []).length; ci++) {
                validKeys.add(`${pi}_${ci}`);
            }
        }
        currentLlmGeoData = {};
        for (const [key, val] of Object.entries(llmGeo)) {
            if (validKeys.has(key)) currentLlmGeoData[key] = val;
        }

        // Build globe data for current author mode
        rebuildGlobeData();

        // Build network
        const cfg = loadConfig();
        currentResearcherName = data.researcher || cfg.researcherName || 'Researcher';
        currentNetwork = buildNetwork(currentResearcherName, currentPublications, themes, summaries);

        emptyState.style.display = 'none';
        btnExport.disabled = false;
        renderCurrentNetwork();

        console.log(`Loaded snapshot: ${currentPublications.length} publications`);
    } catch (e) {
        // No snapshot or failed to load — silent, user will configure manually
    }
}

/**
 * Rebuild globe geo data based on current author mode (first author vs all authors).
 * Merges LLM base data with profile-inferred data.
 */
function rebuildGlobeData() {
    const firstAuthorOnly = authorModeSelect.value === 'first';

    // Build profile-based geo data for current author mode
    const profileGeo = (Object.keys(currentScholarProfiles).length > 0)
        ? buildGeoFromProfiles(currentPublications, currentScholarProfiles, firstAuthorOnly)
        : {};

    if (firstAuthorOnly) {
        // First author mode: keys are pi_ci — merge LLM base + profile overlay
        currentGeoData = {};
        for (const [key, val] of Object.entries(currentLlmGeoData)) {
            currentGeoData[key] = val;
        }
        for (const [key, val] of Object.entries(profileGeo)) {
            if (val.country) {
                currentGeoData[key] = val;
            } else if (!currentGeoData[key]) {
                currentGeoData[key] = val;
            }
        }
    } else {
        // All authors mode: keys are pi_ci_ai — profile data is primary
        // Start with profile geo (multi-country per citation)
        currentGeoData = { ...profileGeo };

        // For citations where profiles didn't provide a country, fall back to LLM data
        const profileCitationsWithCountry = new Set();
        for (const [k, v] of Object.entries(profileGeo)) {
            if (v.country) {
                const parts = k.split('_');
                profileCitationsWithCountry.add(`${parts[0]}_${parts[1]}`);
            }
        }
        for (const [key, val] of Object.entries(currentLlmGeoData)) {
            if (!profileCitationsWithCountry.has(key) && val.country) {
                currentGeoData[key] = val;
            }
        }
    }

    if (Object.keys(currentGeoData).length > 0) {
        const agg = aggregateGeoData(currentGeoData);
        currentGlobePoints = agg.points;
        currentGlobeStats = { countryCount: agg.countryCount, totalMapped: agg.totalMapped };
    } else {
        currentGlobePoints = null;
        currentGlobeStats = null;
    }
}

// ── View Toggle ──
viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    const view = btn.dataset.view;
    if (view === currentView) return;

    currentView = view;

    // Update toggle buttons
    viewToggle.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Hide all views
    graphContainer.style.display = 'none';
    globeWrapper.style.display = 'none';
    scholarContainer.style.display = 'none';
    document.getElementById('legend').style.display = 'none';
    document.getElementById('filterBar').style.display = 'none';
    destroyGlobe();

    if (view === 'network') {
        graphContainer.style.display = 'block';
        document.getElementById('legend').style.display = currentNetwork ? 'block' : 'none';
        document.getElementById('filterBar').style.display = 'flex';
        if (currentNetwork) renderCurrentNetwork();
    } else if (view === 'globe') {
        globeWrapper.style.display = 'block';
        if (currentGlobePoints && currentGlobePoints.length > 0) {
            globeEmpty.style.display = 'none';
            initGlobe(globeContainer, currentGlobePoints, currentGlobeStats);
            renderRankings();
        } else {
            globeEmpty.style.display = 'flex';
            rankingsSection.style.display = 'none';
        }
    } else if (view === 'scholar') {
        scholarContainer.style.display = 'block';
        renderScholarData();
    }
});

// ── Loading UI ──
function showLoading(text, pct, detail) {
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = text || 'Loading...';
    progressFill.style.width = `${pct || 0}%`;
    loadingDetail.textContent = detail || '';
}
function hideLoading() {
    loadingOverlay.style.display = 'none';
}

function updateStats(publications) {
    const stats = computeStats(publications);
    document.getElementById('statPubs').textContent = `📄 ${stats.totalPubs}`;
    document.getElementById('statCitations').textContent = `📊 ${stats.totalCitations}`;
    document.getElementById('statHIndex').textContent = `📈 H: ${stats.hIndex}`;
}

// ── Tooltip ──
function showTooltip(event, d) {
    let html = '';
    if (d.type === 'researcher') {
        html = `<div class="tt-title">${d.label}</div><div class="tt-meta">Center researcher</div>`;
    } else if (d.type === 'publication') {
        html = `<div class="tt-title">${d.label}</div>`;
        html += `<div class="tt-meta">Year: ${d.year || '—'} &nbsp;|&nbsp; Citations: ${d.citationCount || 0}</div>`;
        if (d.theme && d.theme !== 'Uncategorized') {
            html += `<span class="tt-theme" style="background:${d.themeColor}33;color:${d.themeColor}">${d.theme}</span>`;
        }
        if (d.summary) {
            html += `<div class="tt-summary">${d.summary}</div>`;
        }
        html += `<div class="tt-meta" style="margin-top:6px;font-style:italic">Click to ${d.childrenExpanded ? 'collapse' : 'expand'} citations</div>`;
    } else if (d.type === 'citation') {
        html = `<div class="tt-title">${d.label}</div>`;
        if (d.authors) html += `<div class="tt-meta">${d.authors}</div>`;
        if (d.year) html += `<div class="tt-meta">Year: ${d.year}</div>`;
    }

    tooltip.innerHTML = html;
    tooltip.classList.add('visible');

    const x = event.clientX + 15;
    const y = event.clientY + 15;
    tooltip.style.left = `${Math.min(x, window.innerWidth - 400)}px`;
    tooltip.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
}

function hideTooltip() {
    tooltip.classList.remove('visible');
}

// ── Toggle Citations ──
function toggleCitations(pubNode) {
    pubNode.childrenExpanded = !pubNode.childrenExpanded;
    const expand = pubNode.childrenExpanded;

    for (const node of currentNetwork.nodes) {
        if (node.type === 'citation' && node.parentPubId === pubNode.id) {
            node.hidden = !expand;
        }
    }

    applyFiltersAndRender();
}

// ── Render ──
// ── Render whichever view is currently active ──
function renderActiveView() {
    btnExport.disabled = !currentPublications || currentPublications.length === 0;

    if (currentView === 'network') {
        renderCurrentNetwork();
    } else if (currentView === 'globe') {
        if (currentGlobePoints && currentGlobePoints.length > 0) {
            globeEmpty.style.display = 'none';
            initGlobe(globeContainer, currentGlobePoints, currentGlobeStats);
            renderRankings();
        }
    } else if (currentView === 'scholar') {
        renderScholarData();
    }
}

function renderCurrentNetwork() {
    if (!currentNetwork || currentNetwork.nodes.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';
    btnExport.disabled = false;

    renderGraph(currentNetwork, {
        onTooltip: showTooltip,
        onHideTooltip: hideTooltip,
        onToggleCitations: toggleCitations,
    });
}

function applyFiltersAndRender() {
    if (!currentNetwork) return;

    const filters = {
        yearFrom: parseInt(filterYearFrom.value) || null,
        yearTo: parseInt(filterYearTo.value) || null,
        recentN: filterTopKMode.value === 'recent' ? (parseInt(filterTopKValue.value) || null) : null,
        citedN: filterTopKMode.value === 'cited' ? (parseInt(filterTopKValue.value) || null) : null,
        search: filterSearch.value.trim() || null,
    };

    const hasFilters = Object.values(filters).some(v => v !== null);
    const displayed = hasFilters ? filterNetwork(currentNetwork, filters) : currentNetwork;

    renderGraph(displayed, {
        onTooltip: showTooltip,
        onHideTooltip: hideTooltip,
        onToggleCitations: toggleCitations,
    });
}

// ── Refresh ──
btnRefresh.addEventListener('click', async () => {
    const cfg = loadConfig();
    const missing = validateConfig(cfg);
    if (missing.length > 0) {
        alert(`Please configure: ${missing.join(', ')}`);
        document.getElementById('btnSettings').click();
        return;
    }

    try {
        showLoading('Starting...', 0);

        let publications;

        // Selenium mode: call local Python server
        publications = await fetchViaSeleniumServer(cfg);

        currentPublications = publications;
        updateStats(currentPublications);

        // LLM analysis — themes + summaries
        let summaries = {};
        let themes = {};
        if (cfg.llmKey) {
            try {
                const analysis = await analyzePapers(currentPublications, cfg, (msg, pct) => showLoading(msg, pct));
                summaries = analysis.summaries;
                themes = analysis.themes;
            } catch (e) {
                console.warn('LLM analysis failed, continuing without:', e);
            }

            // LLM geo extraction
            try {
                showLoading('Extracting citation geolocation...', 85);
                currentGeoData = await extractCitationGeo(currentPublications, cfg, (msg, pct) => showLoading(msg, pct));
                const agg = aggregateGeoData(currentGeoData);
                currentGlobePoints = agg.points;
                currentGlobeStats = { countryCount: agg.countryCount, totalMapped: agg.totalMapped };
            } catch (e) {
                console.warn('LLM geo extraction failed:', e);
            }

            // LLM institution name cleaning
            if (Object.keys(currentScholarProfiles).length > 0) {
                try {
                    showLoading('Cleaning institution names...', 92);
                    currentScholarProfiles = await cleanInstitutions(
                        currentScholarProfiles, cfg, (msg, pct) => showLoading(msg, pct)
                    );
                } catch (e) {
                    console.warn('Institution cleaning failed:', e);
                }
            }
        }

        // Save themes/summaries for export
        currentThemes = themes;
        currentSummaries = summaries;

        // Build network
        currentNetwork = buildNetwork(cfg.researcherName, currentPublications, themes, summaries);

        hideLoading();

        renderActiveView();

    } catch (err) {
        hideLoading();
        console.error('Refresh failed:', err);
        alert(`Error: ${err.message}`);
    }
});

// ── Selenium Server Fetch ──
async function fetchViaSeleniumServer(cfg) {
    const serverUrl = cfg.seleniumUrl || 'http://localhost:5555';

    // Check server is running
    showLoading('Connecting to scraper server...', 5);
    try {
        const status = await fetch(`${serverUrl}/status`);
        if (!status.ok) throw new Error('Server not reachable');
    } catch (e) {
        throw new Error(
            `Cannot connect to scraper server at ${serverUrl}.\n\n` +
            'Start it with: python scraper/server.py\n\n' +
            'Run: python scraper/server.py'
        );
    }

    // Trigger scrape
    showLoading('Scraping Google Scholar via Selenium (this may take a few minutes)...', 10);
    const resp = await fetch(`${serverUrl}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            scholarId: cfg.scholarId,
            headless: true,
            fetchFullAuthors: true,
        }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(`Scraper error: ${err.error || resp.statusText}`);
    }

    showLoading('Processing results...', 90);
    const data = await resp.json();

    // The server returns the full network.json structure
    // Extract scholar profiles and author citations if present
    if (data.scholarProfiles) currentScholarProfiles = data.scholarProfiles;
    if (data.authorCitations) currentAuthorCitations = data.authorCitations;

    return data.publications || [];
}

// ── Export ──
btnExport.addEventListener('click', () => {
    const cfg = loadConfig();
    exportNetworkJSON({
        researcher: cfg.researcherName,
        publications: currentPublications,
        geoData: currentGeoData || {},
        themes: currentThemes || {},
        summaries: currentSummaries || {},
        authorCitations: currentAuthorCitations || {},
        scholarProfiles: currentScholarProfiles || {},
    }, cfg.scholarId);
});

// ── Import ──
btnImport.addEventListener('click', async () => {
    const data = await importNetworkJSON();
    if (!data) return;

    cachedImportData = data;
    currentPublications = data.publications || [];
    const cfg = loadConfig();

    updateStats(currentPublications);

    // Restore geo data if present
    if (data.geoData && Object.keys(data.geoData).length > 0) {
        currentGeoData = data.geoData;
        const agg = aggregateGeoData(currentGeoData);
        currentGlobePoints = agg.points;
        currentGlobeStats = { countryCount: agg.countryCount, totalMapped: agg.totalMapped };
    }

    // Restore author citations and scholar profiles if present
    if (data.authorCitations) currentAuthorCitations = data.authorCitations;
    if (data.scholarProfiles) currentScholarProfiles = data.scholarProfiles;

    // Rebuild network from imported data
    currentNetwork = buildNetwork(
        data.researcher || cfg.researcherName || 'Researcher',
        currentPublications,
        {},
        {}
    );

    emptyState.style.display = 'none';

    renderActiveView();
});

// ── Filters ──
btnApplyFilter.addEventListener('click', applyFiltersAndRender);
btnClearFilter.addEventListener('click', () => {
    filterYearFrom.value = '';
    filterYearTo.value = '';
    filterTopKMode.value = '';
    filterTopKValue.value = '';
    filterSearch.value = '';
    filterShowCitations.checked = true;
    if (currentNetwork) {
        for (const node of currentNetwork.nodes) {
            if (node.type === 'citation') node.hidden = false;
            if (node.type === 'publication') node.childrenExpanded = true;
        }
        renderCurrentNetwork();
    }
});

filterSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFiltersAndRender();
});

// ── Show/Hide Citations Toggle ──
filterShowCitations.addEventListener('change', () => {
    if (!currentNetwork) return;
    const show = filterShowCitations.checked;
    for (const node of currentNetwork.nodes) {
        if (node.type === 'citation') {
            node.hidden = !show;
        }
        if (node.type === 'publication') {
            node.childrenExpanded = show;
        }
    }
    applyFiltersAndRender();
});

// ── Rankings ──
const rankTopKInput = document.getElementById('rankTopK');

function renderRankings() {
    if (!currentGeoData || Object.keys(currentGeoData).length === 0) {
        rankingsSection.style.display = 'none';
        return;
    }

    const topK = parseInt(rankTopKInput.value) || 10;
    rankingsSection.style.display = 'block';

    // Aggregate by country
    const countryCounts = {};
    const institutionCounts = {};

    for (const [, info] of Object.entries(currentGeoData)) {
        if (info.country) {
            countryCounts[info.country] = (countryCounts[info.country] || 0) + 1;
        }
        if (info.institution) {
            const key = info.institution;
            if (!institutionCounts[key]) {
                institutionCounts[key] = { count: 0, country: info.country || '' };
            }
            institutionCounts[key].count += 1;
        }
    }

    // Sort and take top K
    const topCountries = Object.entries(countryCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topK);

    const topInstitutions = Object.entries(institutionCounts)
        .map(([name, data]) => ({ name, count: data.count, country: data.country }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topK);

    // Render countries
    const maxCountry = topCountries[0]?.count || 1;
    document.getElementById('rankCountries').innerHTML = topCountries.map((item, i) => `
        <div class="ranking-row">
            <div class="ranking-pos">${i + 1}</div>
            <div class="ranking-info">
                <div class="ranking-name">${item.name}</div>
            </div>
            <div class="ranking-bar-wrap">
                <div class="ranking-bar" style="width:${(item.count / maxCountry) * 100}%"></div>
            </div>
            <div class="ranking-count">${item.count}</div>
        </div>
    `).join('');

    // Render institutions
    const maxInst = topInstitutions[0]?.count || 1;
    document.getElementById('rankInstitutions').innerHTML = topInstitutions.map((item, i) => `
        <div class="ranking-row">
            <div class="ranking-pos">${i + 1}</div>
            <div class="ranking-info">
                <div class="ranking-name">${item.name}</div>
                <div class="ranking-detail">${item.country}</div>
            </div>
            <div class="ranking-bar-wrap">
                <div class="ranking-bar" style="width:${(item.count / maxInst) * 100}%"></div>
            </div>
            <div class="ranking-count">${item.count}</div>
        </div>
    `).join('');
}

rankTopKInput.addEventListener('change', renderRankings);
rankTopKInput.addEventListener('input', renderRankings);

// ── Scholar View ──
function renderScholarData() {
    if (!currentPublications || currentPublications.length === 0) {
        scholarEmpty.style.display = 'flex';
        return;
    }
    scholarEmpty.style.display = 'none';

    const cfg = loadConfig();
    const researcherName = currentResearcherName || cfg.researcherName || '';

    const firstAuthorOnly = authorModeSelect.value === 'first';
    const collaborators = parseCoAuthors(currentPublications, researcherName, currentProfileInfo, currentScholarProfiles);
    const citingAuthors = parseCitingAuthors(
        currentPublications, currentGeoData || {}, firstAuthorOnly, currentScholarProfiles
    );

    // Apply cached author citation counts (backward compat for old data without profiles)
    for (const author of citingAuthors) {
        if (!author.authorCitations && currentAuthorCitations[author.name]) {
            author.authorCitations = currentAuthorCitations[author.name];
        }
    }

    renderScholarView(scholarContainer, collaborators, citingAuthors, onFetchAuthorCitations);
}

async function onFetchAuthorCitations(authors) {
    // Citation counts are already available from Scholar profiles scraped via Selenium.
    // This button is kept for backward compatibility but no longer needs a separate fetch.
    alert('Citation counts are already fetched from Scholar profiles during scraping. Re-run Refresh to update.');
}

// ── Author Mode Toggle ──
authorModeSelect.addEventListener('change', () => {
    // Rebuild globe data for new author mode
    rebuildGlobeData();

    if (currentView === 'scholar') {
        renderScholarData();
    } else if (currentView === 'globe') {
        // Re-render globe with new data
        destroyGlobe();
        if (currentGlobePoints && currentGlobePoints.length > 0) {
            globeEmpty.style.display = 'none';
            initGlobe(globeContainer, currentGlobePoints, currentGlobeStats);
            renderRankings();
        } else {
            globeEmpty.style.display = 'flex';
            rankingsSection.style.display = 'none';
        }
    }
});
