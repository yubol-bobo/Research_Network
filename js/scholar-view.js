// ── Scholar View: Collaborators & Citing Authors ──

let currentSort = { collaborators: { key: 'paperCount', asc: false }, citing: { key: 'citCount', asc: false } };
let collaboratorsData = [];
let citingAuthorsData = [];
let collaboratorsFilter = '';
let citingFilter = '';
let fetchCitationsCallback = null;

/**
 * Clean an institution string to show only the university/organization name.
 * Strips titles, degrees, departments, etc.
 */
export function cleanInstitution(raw) {
    if (!raw || raw === '—') return raw;
    if (/^unknown/i.test(raw)) return '—';

    // Patterns to strip from the beginning
    const prefixes = [
        /^(Distinguished |Emeritus |Adjunct |Visiting |Honorary |Senior |Junior |Lead |Principal |Chief |Staff |Research )*/i,
        /^(Full |Associate |Assistant )?(Professor|Prof\.|Lecturer|Instructor|Fellow|Scientist|Researcher|Engineer|Director|Dean|Chair|Head)/i,
        /^(Postdoc|Post-doc|Postdoctoral (researcher|fellow|associate))/i,
        /^(PhD|Ph\.?D\.?|Doctoral|Master'?s?|MSc|MS|MA|MBA|MPhil|BS|BSc|BA) ?(student|candidate|researcher)?/i,
        /^(Research (Scientist|Engineer|Associate|Fellow|Assistant|Director))/i,
        /^(AI |ML |NLP |Software |Data )?(Scientist|Engineer|Researcher|Developer)/i,
        /^(Founder|Co-?founder|CEO|CTO|COO|VP|President|Manager)/i,
        /^(of |in |at |@ )?(Computer Science|Electrical Engineering|Mathematics|Statistics|Physics|Chemistry|Biology|Medicine|Economics|Psychology|Linguistics)/i,
    ];

    // Try splitting by common separators and finding the institution part
    // Common patterns: "Title, Dept, University" or "Title @ University" or "Title at University"
    let cleaned = raw;

    // Handle "@ University" or "Title@Company" pattern
    // Take the LAST @-separated institution if multiple exist
    const atParts = cleaned.split(/(?:,\s*)?(?:@|(?:\bat\b))\s*/i).filter(Boolean);
    if (atParts.length > 1) {
        cleaned = atParts[atParts.length - 1].trim();
    }

    // Split by comma and work backwards to find the institution
    const parts = cleaned.split(',').map(p => p.trim());
    if (parts.length > 1) {
        // Walk from the end; find the first part that looks like an institution name
        let instStart = -1;
        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i].trim();
            // Skip if it looks like a title/role
            if (/^(PhD|Ph\.?D|Professor|Prof\.|Postdoc|Post-?doc|Research|Assistant|Associate|Senior|Junior|Distinguished|Visiting|Director|Fellow|Lecturer|Student|Candidate|Engineer|Scientist|Master|Doctoral|Founder|CEO|CTO|Co-?founder|AI |ML |NLP |Software |Data )/i.test(part)) {
                continue;
            }
            // Skip if it's a department-only reference
            if (/^(Department|Dept|School|Faculty|College|Division|Center|Centre|Lab|Group|Institute|Program) (of|for|in) /i.test(part)) {
                continue;
            }
            // Skip if very short or looks like a degree
            if (part.length < 3) continue;
            if (/^(MS|MSc|MA|MBA|BS|BSc|BA|MPhil|CSE|ECE|EE|CS|SE)\b/i.test(part) && part.length < 15) continue;

            // Check if this part contains "University", "Institute", "College" etc — strong signal
            if (/University|Institut|College|Polytechnic|School of|Academy|Labs?$|Inc\.|Corp|Google|Microsoft|Meta|Amazon|DeepMind|OpenAI|NVIDIA/i.test(part)) {
                instStart = i;
                break;
            }

            // Otherwise accept it as a potential institution
            instStart = i;
            break;
        }

        if (instStart >= 0) {
            // Check if the part before instStart is "University of X" that continues with location
            // e.g. ["University of California", "Santa Cruz"] should stay together
            if (instStart > 0) {
                const prev = parts[instStart - 1].trim();
                if (/University of|Institut[eo]? (of|de|für)|Universit[éyà]/i.test(prev)) {
                    instStart = instStart - 1;
                }
            }
            cleaned = parts.slice(instStart).join(', ').trim();
        }
    }

    // Clean up remaining title prefixes
    cleaned = cleaned
        .replace(/^(and |& )?(Head|Director|Chair|Dean|Professor|Fellow|Member) (of |at |in )*/i, '')
        .replace(/^\s*[,;]\s*/, '')
        .trim();

    // If we ended up with something too short or empty, return original
    if (cleaned.length < 3) return raw;

    return cleaned;
}

/**
 * Render the Scholar view with collaborators and citing authors.
 */
export function renderScholarView(container, collaborators, citingAuthors, onFetchCitations) {
    collaboratorsData = collaborators;
    citingAuthorsData = citingAuthors;
    fetchCitationsCallback = onFetchCitations;
    collaboratorsFilter = '';
    citingFilter = '';

    container.innerHTML = `
        <div class="scholar-view">
            <div class="scholar-section">
                <div class="scholar-section-header">
                    <h2>Collaborators</h2>
                    <span class="scholar-count">${collaborators.length} co-authors</span>
                    <input type="text" class="scholar-search" id="searchCollaborators" placeholder="Search collaborators...">
                </div>
                <div class="scholar-table-wrap">
                    <table class="scholar-table" id="tableCollaborators">
                        <thead>
                            <tr>
                                <th class="th-rank">#</th>
                                <th class="th-sortable" data-table="collaborators" data-key="name">Name</th>
                                <th class="th-sortable th-num" data-table="collaborators" data-key="paperCount">Papers Together</th>
                            </tr>
                        </thead>
                        <tbody id="tbodyCollaborators"></tbody>
                    </table>
                </div>
            </div>
            <div class="scholar-section">
                <div class="scholar-section-header">
                    <h2>Citing Authors</h2>
                    <span class="scholar-count">${citingAuthors.length} authors</span>
                    <button class="btn btn-sm btn-fetch-citations" id="btnFetchCitations" title="Fetch real citation counts from Google Scholar via Selenium">Fetch Citations</button>
                    <input type="text" class="scholar-search" id="searchCiting" placeholder="Search citing authors...">
                </div>
                <div class="scholar-table-wrap">
                    <table class="scholar-table" id="tableCiting">
                        <thead>
                            <tr>
                                <th class="th-rank">#</th>
                                <th class="th-sortable" data-table="citing" data-key="name">Name</th>
                                <th class="th-sortable th-num" data-table="citing" data-key="citCount">Times Cited</th>
                                <th class="th-sortable th-num" data-table="citing" data-key="authorCitations">Total Citations</th>
                                <th class="th-sortable" data-table="citing" data-key="institution">Institution</th>
                                <th class="th-sortable" data-table="citing" data-key="country">Country</th>
                            </tr>
                        </thead>
                        <tbody id="tbodyCiting"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Render initial data
    renderCollaboratorsTable();
    renderCitingTable();

    // Wire Fetch Citations button
    document.getElementById('btnFetchCitations').addEventListener('click', () => {
        if (fetchCitationsCallback && citingAuthorsData.length > 0) {
            fetchCitationsCallback(citingAuthorsData);
        }
    });

    // Wire search
    document.getElementById('searchCollaborators').addEventListener('input', (e) => {
        collaboratorsFilter = e.target.value.toLowerCase();
        renderCollaboratorsTable();
    });
    document.getElementById('searchCiting').addEventListener('input', (e) => {
        citingFilter = e.target.value.toLowerCase();
        renderCitingTable();
    });

    // Wire sortable headers
    container.querySelectorAll('.th-sortable').forEach(th => {
        th.addEventListener('click', () => {
            const table = th.dataset.table;
            const key = th.dataset.key;
            const sortState = currentSort[table];
            if (sortState.key === key) {
                sortState.asc = !sortState.asc;
            } else {
                sortState.key = key;
                sortState.asc = key === 'name'; // default asc for name, desc for numbers
            }
            if (table === 'collaborators') renderCollaboratorsTable();
            else renderCitingTable();

            // Update header indicators
            container.querySelectorAll(`[data-table="${table}"]`).forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(sortState.asc ? 'sort-asc' : 'sort-desc');
        });
    });
}

function renderCollaboratorsTable() {
    const tbody = document.getElementById('tbodyCollaborators');
    if (!tbody) return;

    let data = [...collaboratorsData];
    if (collaboratorsFilter) {
        data = data.filter(d => d.name.toLowerCase().includes(collaboratorsFilter));
    }

    const { key, asc } = currentSort.collaborators;
    data.sort((a, b) => {
        const va = a[key], vb = b[key];
        const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
        return asc ? cmp : -cmp;
    });

    const maxCount = data[0]?.paperCount || 1;

    tbody.innerHTML = data.map((d, i) => `
        <tr>
            <td class="td-rank">${i + 1}</td>
            <td class="td-name">${d.name}</td>
            <td class="td-bar">
                <div class="bar-cell">
                    <div class="bar-fill" style="width:${(d.paperCount / maxCount) * 100}%"></div>
                    <span class="bar-value">${d.paperCount}</span>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderCitingTable() {
    const tbody = document.getElementById('tbodyCiting');
    if (!tbody) return;

    let data = [...citingAuthorsData];
    if (citingFilter) {
        const q = citingFilter;
        data = data.filter(d =>
            d.name.toLowerCase().includes(q) ||
            (d.institution || '').toLowerCase().includes(q) ||
            (d.country || '').toLowerCase().includes(q)
        );
    }

    const { key, asc } = currentSort.citing;
    data.sort((a, b) => {
        const va = a[key] || '', vb = b[key] || '';
        const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
        return asc ? cmp : -cmp;
    });

    const maxCount = data[0]?.citCount || 1;

    tbody.innerHTML = data.map((d, i) => {
        const pubs = d.citedPublications || [];
        const tooltipText = pubs.length > 0
            ? pubs.map(p => `• ${escapeHtml(p)}`).join('\n')
            : '';
        return `
        <tr class="${pubs.length > 0 ? 'has-tooltip' : ''}" ${pubs.length > 0 ? `data-cited-pubs="${escapeAttr(JSON.stringify(pubs))}"` : ''}>
            <td class="td-rank">${i + 1}</td>
            <td class="td-name">${d.name}</td>
            <td class="td-bar">
                <div class="bar-cell">
                    <div class="bar-fill" style="width:${(d.citCount / maxCount) * 100}%"></div>
                    <span class="bar-value">${d.citCount}</span>
                </div>
            </td>
            <td class="td-num">${d.authorCitations ? d.authorCitations.toLocaleString() : '—'}</td>
            <td class="td-text">${cleanInstitution(d.institution) || '—'}</td>
            <td class="td-text">${d.country || '—'}</td>
        </tr>`;
    }).join('');

    // Wire tooltip hover events
    wireTooltips(tbody);
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Create and manage hover tooltip showing cited parent publications */
function wireTooltips(tbody) {
    let tooltip = document.getElementById('scholar-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'scholar-tooltip';
        tooltip.className = 'scholar-tooltip';
        document.body.appendChild(tooltip);
    }

    tbody.querySelectorAll('tr.has-tooltip').forEach(row => {
        row.addEventListener('mouseenter', (e) => {
            const pubs = JSON.parse(row.dataset.citedPubs || '[]');
            if (pubs.length === 0) return;

            const name = row.querySelector('.td-name')?.textContent || '';
            tooltip.innerHTML = `
                <div class="tooltip-header">Publications cited by ${escapeHtml(name)}</div>
                <ul class="tooltip-list">
                    ${pubs.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
                </ul>
            `;
            tooltip.style.display = 'block';
            positionTooltip(tooltip, row);
        });

        row.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

function positionTooltip(tooltip, row) {
    const rect = row.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // Position above the row, centered horizontally
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.top - tooltipRect.height - 8;

    // If tooltip would go above viewport, show below
    if (top < 8) {
        top = rect.bottom + 8;
    }
    // Keep within viewport horizontally
    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tooltipRect.width - 8;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}
