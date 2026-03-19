// ── Main Application Entry ──

import { loadConfig, validateConfig, initSettingsModal } from './config.js';
import { fetchScholarData, parseCoAuthors, parseCitingAuthors } from './scholar.js';
import { exportNetworkJSON, importNetworkJSON, mergePublications, buildCacheMap } from './cache.js';
import { buildNetwork, filterNetwork, computeStats } from './network.js';
import { initGraph, renderGraph, destroyGraph } from './graph.js';
import { analyzePapers, extractCitationGeo } from './llm.js';
import { aggregateGeoData, initGlobe, destroyGlobe } from './globe.js';
import { renderScholarView } from './scholar-view.js';

// ── State ──
let currentPublications = [];
let currentNetwork = null;
let cachedImportData = null;
let currentGeoData = null;   // raw { "pubIdx_citIdx": { country, institution } }
let currentGlobePoints = null; // aggregated points for globe
let currentGlobeStats = null;
let currentThemes = {};      // { pubTitle: { theme, color } }
let currentSummaries = {};   // { pubTitle: summary }
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

        // Restore geo data
        if (data.geoData && Object.keys(data.geoData).length > 0) {
            currentGeoData = data.geoData;
            const agg = aggregateGeoData(currentGeoData);
            currentGlobePoints = agg.points;
            currentGlobeStats = { countryCount: agg.countryCount, totalMapped: agg.totalMapped };
        }

        // Restore themes and summaries if present
        const themes = data.themes || {};
        const summaries = data.summaries || {};

        // Build network
        const cfg = loadConfig();
        const name = data.researcher || cfg.researcherName || 'Researcher';
        currentNetwork = buildNetwork(name, currentPublications, themes, summaries);

        emptyState.style.display = 'none';
        btnExport.disabled = false;
        renderCurrentNetwork();

        console.log(`Loaded snapshot: ${currentPublications.length} publications`);
    } catch (e) {
        // No snapshot or failed to load — silent, user will configure manually
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
        const existingPubs = cachedImportData?.publications || currentPublications;
        const cacheMap = buildCacheMap(existingPubs);

        showLoading('Starting...', 0);

        const publications = await fetchScholarData(
            cfg.scholarId,
            cfg.scraperKey,
            (msg, pct, detail) => showLoading(msg, pct, detail),
            cacheMap
        );

        currentPublications = mergePublications(existingPubs, publications);
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
        }

        // Save themes/summaries for export
        currentThemes = themes;
        currentSummaries = summaries;

        // Build network
        currentNetwork = buildNetwork(cfg.researcherName, currentPublications, themes, summaries);

        hideLoading();

        if (currentView === 'network') {
            renderCurrentNetwork();
        } else {
            if (currentGlobePoints && currentGlobePoints.length > 0) {
                globeEmpty.style.display = 'none';
                initGlobe(globeContainer, currentGlobePoints, currentGlobeStats);
                renderRankings();
            }
        }

    } catch (err) {
        hideLoading();
        console.error('Refresh failed:', err);
        alert(`Error: ${err.message}`);
    }
});

// ── Export ──
btnExport.addEventListener('click', () => {
    const cfg = loadConfig();
    exportNetworkJSON({
        researcher: cfg.researcherName,
        publications: currentPublications,
        geoData: currentGeoData || {},
        themes: currentThemes || {},
        summaries: currentSummaries || {},
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

    // Rebuild network from imported data
    currentNetwork = buildNetwork(
        data.researcher || cfg.researcherName || 'Researcher',
        currentPublications,
        {},
        {}
    );

    emptyState.style.display = 'none';

    if (currentView === 'network') {
        renderCurrentNetwork();
    } else {
        if (currentGlobePoints && currentGlobePoints.length > 0) {
            globeEmpty.style.display = 'none';
            initGlobe(globeContainer, currentGlobePoints, currentGlobeStats);
            renderRankings();
        }
    }
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
    const researcherName = cfg.researcherName || '';

    const collaborators = parseCoAuthors(currentPublications, researcherName);
    const citingAuthors = parseCitingAuthors(currentPublications, currentGeoData || {});

    renderScholarView(scholarContainer, collaborators, citingAuthors);
}
