// ── Build Network Data Structure ──

/**
 * Build a node-link network from researcher + publications.
 *
 * @param {string} researcherName
 * @param {Array} publications - array of pub objects with .citations
 * @param {Object} themes - { pubTitle: { theme, color } } from LLM
 * @param {Object} summaries - { pubTitle: summary } from LLM
 * @returns {{ nodes: Array, links: Array, themes: Array }}
 */
export function buildNetwork(researcherName, publications, themes = {}, summaries = {}) {
    const nodes = [];
    const links = [];
    const themeSet = new Map(); // theme name -> color

    // Center node
    const researcherId = 'researcher';
    nodes.push({
        id: researcherId,
        label: researcherName,
        type: 'researcher',
        level: 0,
    });

    for (let i = 0; i < publications.length; i++) {
        const pub = publications[i];
        const pubId = `pub_${i}`;
        const themeInfo = themes[pub.title] || {};
        const summary = summaries[pub.title] || '';

        if (themeInfo.theme && themeInfo.color) {
            themeSet.set(themeInfo.theme, themeInfo.color);
        }

        nodes.push({
            id: pubId,
            label: pub.title,
            type: 'publication',
            level: 1,
            year: pub.year,
            citationCount: pub.citationCount,
            articleUrl: pub.articleUrl,
            theme: themeInfo.theme || 'Uncategorized',
            themeColor: themeInfo.color || '#6366f1',
            summary,
            childrenExpanded: true,
        });

        links.push({
            source: researcherId,
            target: pubId,
            type: 'researcher-pub',
        });

        // Citation nodes (deduplicated, skip self-citations)
        if (pub.citations && pub.citations.length > 0) {
            const seenTitles = new Set();
            const pubTitleKey = pub.title.toLowerCase().replace(/\s+/g, ' ');
            for (let j = 0; j < pub.citations.length; j++) {
                const cit = pub.citations[j];
                const citKey = cit.title.toLowerCase().replace(/\s+/g, ' ');
                // Skip duplicates and self-citations (fuzzy: prefix match for truncated titles)
                const isSelfCite = citKey === pubTitleKey
                    || pubTitleKey.startsWith(citKey.replace(/\.{2,}$/, '').trim())
                    || citKey.replace(/\.{2,}$/, '').trim().startsWith(pubTitleKey.slice(0, 50));
                if (seenTitles.has(citKey) || isSelfCite) continue;
                seenTitles.add(citKey);
                const citId = `cit_${i}_${j}`;

                nodes.push({
                    id: citId,
                    label: cit.title,
                    type: 'citation',
                    level: 2,
                    year: cit.year,
                    authors: cit.authors,
                    link: cit.link,
                    parentPubId: pubId,
                    parentThemeColor: themeInfo.color || '#6366f1',
                    hidden: false, // start expanded
                });

                links.push({
                    source: pubId,
                    target: citId,
                    type: 'pub-citation',
                });
            }
        }
    }

    // Build theme legend data
    if (!themeSet.has('Uncategorized')) {
        themeSet.set('Uncategorized', '#6366f1');
    }
    const themeList = Array.from(themeSet.entries()).map(([name, color]) => ({ name, color }));

    return { nodes, links, themes: themeList };
}

/**
 * Apply filters to a network, returning filtered nodes and links.
 */
export function filterNetwork(network, { yearFrom, yearTo, recentN, citedN, search }) {
    let pubs = network.nodes.filter(n => n.type === 'publication');

    if (yearFrom) pubs = pubs.filter(n => n.year >= yearFrom);
    if (yearTo) pubs = pubs.filter(n => n.year <= yearTo);
    if (search) {
        const q = search.toLowerCase();
        pubs = pubs.filter(n => n.label.toLowerCase().includes(q));
    }

    // "Recent Top K" — sort by year descending, take top K
    if (recentN && recentN > 0) {
        pubs.sort((a, b) => (b.year || 0) - (a.year || 0));
        pubs = pubs.slice(0, recentN);
    }

    // "Most Cited Top K" — sort by citation count descending, take top K
    if (citedN && citedN > 0) {
        pubs.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
        pubs = pubs.slice(0, citedN);
    }

    const pubIds = new Set(pubs.map(n => n.id));

    // Include researcher node, filtered pubs, and their visible citations
    const filteredNodes = [
        network.nodes.find(n => n.type === 'researcher'),
        ...pubs,
        ...network.nodes.filter(n =>
            n.type === 'citation' &&
            pubIds.has(n.parentPubId) &&
            !n.hidden
        ),
    ].filter(Boolean);

    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = network.links.filter(l => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        return nodeIds.has(src) && nodeIds.has(tgt);
    });

    return { nodes: filteredNodes, links: filteredLinks, themes: network.themes };
}

/**
 * Compute stats from publications.
 */
export function computeStats(publications) {
    const totalPubs = publications.length;
    const totalCitations = publications.reduce((s, p) => s + (p.citationCount || 0), 0);

    // h-index: largest h such that h papers have >= h citations
    const sorted = publications.map(p => p.citationCount || 0).sort((a, b) => b - a);
    let hIndex = 0;
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] >= i + 1) hIndex = i + 1;
        else break;
    }

    return { totalPubs, totalCitations, hIndex };
}
