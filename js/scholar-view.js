// ── Scholar View: Collaborators & Citing Authors ──

let currentSort = { collaborators: { key: 'paperCount', asc: false }, citing: { key: 'citCount', asc: false } };
let collaboratorsData = [];
let citingAuthorsData = [];
let collaboratorsFilter = '';
let citingFilter = '';
let fetchCitationsCallback = null;

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
                    <button class="btn btn-sm btn-fetch-citations" id="btnFetchCitations" title="Fetch real citation counts from Google Scholar via ScraperAPI">Fetch Citations</button>
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

    tbody.innerHTML = data.map((d, i) => `
        <tr>
            <td class="td-rank">${i + 1}</td>
            <td class="td-name">${d.name}</td>
            <td class="td-bar">
                <div class="bar-cell">
                    <div class="bar-fill" style="width:${(d.citCount / maxCount) * 100}%"></div>
                    <span class="bar-value">${d.citCount}</span>
                </div>
            </td>
            <td class="td-num">${d.authorCitations ? d.authorCitations.toLocaleString() : '—'}</td>
            <td class="td-text">${d.institution || '—'}</td>
            <td class="td-text">${d.country || '—'}</td>
        </tr>
    `).join('');
}
