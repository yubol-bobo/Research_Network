// ── Main Application Entry ──
// Read-only viewer: loads data/network.json and renders three views.

import { parseCoAuthors, parseCitingAuthors } from './scholar.js';
import { buildNetwork, filterNetwork, computeStats } from './network.js';
import { initGraph, renderGraph, destroyGraph } from './graph.js';
import { aggregateGeoData, buildGeoFromProfiles, initGlobe, destroyGlobe } from './globe.js';
import { renderScholarView } from './scholar-view.js';

// ── State ──
let currentPublications = [];
let currentNetwork = null;
let currentGeoData = null;
let currentLlmGeoData = {};
let currentGlobePoints = null;
let currentGlobeStats = null;
let currentThemes = {};
let currentSummaries = {};
let currentAuthorCitations = {};
let currentScholarProfiles = {};
let currentProfileInfo = {};
let currentResearcherName = '';
let currentView = 'network';

// ── DOM Refs ──
const graphContainer = document.getElementById('graphContainer');
const globeWrapper = document.getElementById('globeWrapper');
const globeContainer = document.getElementById('globeContainer');
const emptyState = document.getElementById('emptyState');
const globeEmpty = document.getElementById('globeEmpty');
const rankingsSection = document.getElementById('rankingsSection');
const scholarContainer = document.getElementById('scholarContainer');
const scholarEmpty = document.getElementById('scholarEmpty');
const tooltip = document.getElementById('tooltip');

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
initGraph(graphContainer);
autoLoadSnapshot();

// ── Auto-load data/network.json ──
async function autoLoadSnapshot() {
    try {
        const resp = await fetch('data/network.json');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.publications || data.publications.length === 0) return;

        currentPublications = data.publications;
        updateStats(currentPublications);

        // Restore all metadata
        currentThemes = data.themes || {};
        currentSummaries = data.summaries || {};
        if (data.authorCitations) currentAuthorCitations = data.authorCitations;
        if (data.scholarProfiles) currentScholarProfiles = data.scholarProfiles;
        if (data.profileInfo) currentProfileInfo = data.profileInfo;

        // Store base geo data (filtered to valid keys)
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

        // Build globe data
        rebuildGlobeData();

        // Build network
        currentResearcherName = data.researcher || 'Researcher';
        currentNetwork = buildNetwork(currentResearcherName, currentPublications, currentThemes, currentSummaries);

        emptyState.style.display = 'none';
        renderCurrentNetwork();

        console.log(`Loaded: ${currentPublications.length} publications, ${Object.keys(currentScholarProfiles).length} profiles`);
    } catch (e) {
        console.warn('No data/network.json found. Run the scraper first.');
    }
}

/**
 * Rebuild globe geo data based on current author mode.
 */
function rebuildGlobeData() {
    const firstAuthorOnly = authorModeSelect.value === 'first';

    const profileGeo = (Object.keys(currentScholarProfiles).length > 0)
        ? buildGeoFromProfiles(currentPublications, currentScholarProfiles, firstAuthorOnly)
        : {};

    if (firstAuthorOnly) {
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
        currentGeoData = { ...profileGeo };
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

    viewToggle.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

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

// ── Stats ──
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

    const topCountries = Object.entries(countryCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topK);

    const topInstitutions = Object.entries(institutionCounts)
        .map(([name, data]) => ({ name, count: data.count, country: data.country }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topK);

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

    const firstAuthorOnly = authorModeSelect.value === 'first';
    const collaborators = parseCoAuthors(currentPublications, currentResearcherName, currentProfileInfo, currentScholarProfiles);
    const citingAuthors = parseCitingAuthors(
        currentPublications, currentGeoData || {}, firstAuthorOnly, currentScholarProfiles
    );

    // Apply cached author citation counts
    for (const author of citingAuthors) {
        if (!author.authorCitations && currentAuthorCitations[author.name]) {
            author.authorCitations = currentAuthorCitations[author.name];
        }
    }

    renderScholarView(scholarContainer, collaborators, citingAuthors);
}

// ── Author Mode Toggle ──
authorModeSelect.addEventListener('change', () => {
    rebuildGlobeData();

    if (currentView === 'scholar') {
        renderScholarData();
    } else if (currentView === 'globe') {
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
