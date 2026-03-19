// ── Google Scholar Scraping via ScraperAPI ──

const SCRAPER_BASE = 'https://api.scraperapi.com';

function scraperUrl(targetUrl, apiKey) {
    return `${SCRAPER_BASE}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}&render=false`;
}

async function fetchPage(url, apiKey) {
    const resp = await fetch(scraperUrl(url, apiKey));
    if (!resp.ok) throw new Error(`ScraperAPI error ${resp.status}: ${resp.statusText}`);
    return await resp.text();
}

function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
}

// Parse the publications list from a scholar profile page
function parsePublications(doc) {
    const pubs = [];
    const rows = doc.querySelectorAll('#gsc_a_b .gsc_a_tr');
    for (const row of rows) {
        const titleEl = row.querySelector('.gsc_a_at');
        const citedEl = row.querySelector('.gsc_a_ac a, .gsc_a_ac');
        const yearEl = row.querySelector('.gsc_a_y span');

        if (!titleEl) continue;

        const title = titleEl.textContent.trim();
        const href = titleEl.getAttribute('href') || '';
        const articleUrl = href.startsWith('http') ? href : (href ? `https://scholar.google.com${href}` : '');
        const citationCount = parseInt(citedEl?.textContent?.trim()) || 0;
        const year = parseInt(yearEl?.textContent?.trim()) || 0;

        // Extract citation link (cited by page)
        const citedLink = citedEl?.getAttribute('href') || '';
        const citedByUrl = citedLink.startsWith('http') ? citedLink : (citedLink ? `https://scholar.google.com${citedLink}` : '');

        pubs.push({ title, articleUrl, citationCount, year, citedByUrl });
    }
    return pubs;
}

// Check if there's a "Show more" / next page button
function getNextPageUrl(doc, scholarId, currentStart) {
    const btn = doc.querySelector('#gsc_bpf_more');
    if (btn && !btn.disabled) {
        const nextStart = currentStart + 100;
        return `https://scholar.google.com/citations?user=${scholarId}&cstart=${nextStart}&pagesize=100`;
    }
    return null;
}

// Parse citing articles from a "Cited by" search results page
function parseCitations(doc) {
    const citations = [];
    const results = doc.querySelectorAll('.gs_r.gs_or.gs_scl, .gs_ri, .gs_r');
    for (const r of results) {
        const titleEl = r.querySelector('.gs_rt a, .gs_rt');
        const authorEl = r.querySelector('.gs_a');

        if (!titleEl) continue;

        const title = titleEl.textContent.replace(/\[.*?\]\s*/g, '').trim();
        if (!title) continue;

        const authorText = authorEl?.textContent || '';
        // Format: "Authors - Journal/Venue, Year - Publisher"
        const parts = authorText.split(' - ');
        const authors = (parts[0] || '').trim();
        const venue = (parts[1] || '').replace(/,?\s*\d{4}.*/, '').trim();
        const publisher = (parts[2] || '').trim();
        const yearMatch = authorText.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : 0;

        const link = titleEl.tagName === 'A' ? titleEl.getAttribute('href') : '';

        citations.push({ title, authors, year, link, venue, publisher });
    }
    return citations;
}

/**
 * Fetch all publications for a scholar.
 * @param {string} scholarId
 * @param {string} apiKey - ScraperAPI key
 * @param {Function} onProgress - callback(message, percent)
 * @param {Object} cachedPubs - map of title -> pub data to skip
 * @returns {Array} publications with citations
 */
export async function fetchScholarData(scholarId, apiKey, onProgress, cachedPubs = {}) {
    onProgress('Fetching scholar profile...', 5);

    let allPubs = [];
    let pageUrl = `https://scholar.google.com/citations?user=${scholarId}&cstart=0&pagesize=100&sortby=pubdate`;
    let pageNum = 0;

    // Fetch all publication pages
    while (pageUrl) {
        pageNum++;
        onProgress(`Fetching publications page ${pageNum}...`, 5 + pageNum * 3);
        const html = await fetchPage(pageUrl, apiKey);
        const doc = parseHTML(html);
        const pubs = parsePublications(doc);
        if (pubs.length === 0) break;
        allPubs = allPubs.concat(pubs);
        pageUrl = getNextPageUrl(doc, scholarId, (pageNum) * 100);
        if (pageUrl) await delay(1000); // rate limit
    }

    onProgress(`Found ${allPubs.length} publications. Fetching citations...`, 20);

    // Fetch citations for each publication
    const total = allPubs.length;
    for (let i = 0; i < total; i++) {
        const pub = allPubs[i];
        const pct = 20 + Math.round((i / total) * 70);

        // Skip if already cached
        if (cachedPubs[pub.title]) {
            pub.citations = cachedPubs[pub.title].citations || [];
            onProgress(`Skipping cached: ${truncate(pub.title, 50)}`, pct, `${i + 1}/${total}`);
            continue;
        }

        if (pub.citedByUrl && pub.citationCount > 0) {
            onProgress(`Fetching citations for: ${truncate(pub.title, 50)}`, pct, `${i + 1}/${total}`);
            try {
                const html = await fetchPage(pub.citedByUrl, apiKey);
                const doc = parseHTML(html);
                pub.citations = parseCitations(doc);
            } catch (e) {
                console.warn(`Failed to fetch citations for "${pub.title}":`, e);
                pub.citations = [];
            }
            await delay(1200); // rate limit between citation fetches
        } else {
            pub.citations = [];
        }
    }

    onProgress('Done!', 100);
    return allPubs;
}

function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '...' : str;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
