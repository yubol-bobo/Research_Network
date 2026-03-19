// ── JSON Export / Import & Merge ──

/**
 * Export network data as a downloadable JSON file.
 * @param {Object} networkData - { researcher, publications, metadata }
 * @param {string} scholarId
 */
export function exportNetworkJSON(networkData, scholarId) {
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        scholarId,
        ...networkData,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scholarId}_network.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Import network data from a JSON file.
 * @returns {Promise<Object|null>} parsed data or null if cancelled
 */
export function importNetworkJSON() {
    return new Promise((resolve) => {
        const input = document.getElementById('fileImport');
        input.value = '';

        const handler = (e) => {
            input.removeEventListener('change', handler);
            const file = e.target.files[0];
            if (!file) { resolve(null); return; }

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    resolve(data);
                } catch (err) {
                    alert('Invalid JSON file.');
                    resolve(null);
                }
            };
            reader.readAsText(file);
        };

        input.addEventListener('change', handler);
        input.click();
    });
}

/**
 * Merge new publications into existing cached data.
 * Keeps existing publication data (including citations), adds new ones.
 * @param {Array} existingPubs - previously cached publications
 * @param {Array} newPubs - freshly scraped publications
 * @returns {Array} merged publications
 */
export function mergePublications(existingPubs, newPubs) {
    const map = new Map();

    // Index existing by title
    for (const pub of existingPubs) {
        map.set(pub.title, pub);
    }

    // Add/update with new data
    for (const pub of newPubs) {
        if (map.has(pub.title)) {
            // Update citation count but keep cached citations list
            const existing = map.get(pub.title);
            existing.citationCount = pub.citationCount;
            existing.year = pub.year || existing.year;
            // If new data has more citations fetched, use those
            if (pub.citations && pub.citations.length > (existing.citations || []).length) {
                existing.citations = pub.citations;
            }
        } else {
            map.set(pub.title, pub);
        }
    }

    return Array.from(map.values());
}

/**
 * Build a lookup map from cached publications for incremental scraping.
 * @param {Array} pubs
 * @returns {Object} title -> pub data
 */
export function buildCacheMap(pubs) {
    const m = {};
    for (const p of pubs) {
        m[p.title] = p;
    }
    return m;
}
