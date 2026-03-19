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

        // Extract co-author names from the gray line below the title
        const grayEls = row.querySelectorAll('.gs_gray');
        const authorsStr = grayEls[0]?.textContent?.trim() || '';

        pubs.push({ title, articleUrl, citationCount, year, citedByUrl, authors: authorsStr });
    }
    return pubs;
}

/**
 * Extract and aggregate co-authors from publications.
 * @param {Array} publications
 * @param {string} researcherName
 * @returns {Array} sorted by paperCount desc: { name, paperCount, papers[] }
 */
export function parseCoAuthors(publications, researcherName) {
    const coauthorMap = {};
    const researcherParts = researcherName.toLowerCase().split(/\s+/);

    for (const pub of publications) {
        if (!pub.authors) continue;
        const names = pub.authors.split(',').map(n => n.trim()).filter(Boolean);

        for (const name of names) {
            // Skip the researcher themselves (fuzzy match)
            const nameLower = name.toLowerCase();
            const isResearcher = researcherParts.every(p => nameLower.includes(p))
                || nameLower === researcherName.toLowerCase();
            if (isResearcher) continue;

            // Skip ellipsis
            if (name === '...' || name === '…') continue;

            if (!coauthorMap[name]) {
                coauthorMap[name] = { name, paperCount: 0, papers: [] };
            }
            coauthorMap[name].paperCount++;
            coauthorMap[name].papers.push(pub.title);
        }
    }

    return Object.values(coauthorMap).sort((a, b) => b.paperCount - a.paperCount);
}

/**
 * Aggregate citing authors from publication citations + geoData.
 * @param {Array} publications
 * @param {Object} geoData - { "pubIdx_citIdx": { country, institution } }
 * @returns {Array} sorted by citCount desc: { name, citCount, institution, country, papers[] }
 */
export function parseCitingAuthors(publications, geoData = {}) {
    const authorMap = {};

    for (let pi = 0; pi < publications.length; pi++) {
        const pub = publications[pi];
        if (!pub.citations) continue;

        for (let ci = 0; ci < pub.citations.length; ci++) {
            const cit = pub.citations[ci];
            if (!cit.authors) continue;

            // Take first author (primary contributor)
            const firstAuthor = cit.authors.split(',')[0].trim();
            if (!firstAuthor || firstAuthor === '...' || firstAuthor === '…') continue;

            const geo = geoData[`${pi}_${ci}`] || {};

            if (!authorMap[firstAuthor]) {
                authorMap[firstAuthor] = {
                    name: firstAuthor,
                    citCount: 0,
                    authorCitations: geo.authorCitations || 0,
                    institution: geo.institution || '',
                    country: geo.country || '',
                    papers: [],
                };
            }
            authorMap[firstAuthor].citCount++;
            // Keep the highest authorCitations estimate
            if (geo.authorCitations && geo.authorCitations > authorMap[firstAuthor].authorCitations) {
                authorMap[firstAuthor].authorCitations = geo.authorCitations;
            }
            authorMap[firstAuthor].papers.push(cit.title);
            // Update institution/country if we have it and didn't before
            if (geo.institution && !authorMap[firstAuthor].institution) {
                authorMap[firstAuthor].institution = geo.institution;
            }
            if (geo.country && !authorMap[firstAuthor].country) {
                authorMap[firstAuthor].country = geo.country;
            }
        }
    }

    return Object.values(authorMap).sort((a, b) => b.citCount - a.citCount);
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
    const seen = new Set();
    // Use the most specific selector to avoid duplicate matches
    const results = doc.querySelectorAll('.gs_r.gs_or.gs_scl');
    for (const r of results) {
        const titleEl = r.querySelector('.gs_rt a, .gs_rt');
        const authorEl = r.querySelector('.gs_a');

        if (!titleEl) continue;

        const title = titleEl.textContent.replace(/\[.*?\]\s*/g, '').trim();
        if (!title) continue;

        // Deduplicate by normalized title
        const titleKey = title.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(titleKey)) continue;
        seen.add(titleKey);

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
                pub.citations = [];
                let citPageUrl = pub.citedByUrl;
                let citPage = 0;

                // Paginate through all "Cited by" pages (10 results per page)
                while (citPageUrl) {
                    citPage++;
                    if (citPage > 1) {
                        onProgress(`Fetching citations p${citPage} for: ${truncate(pub.title, 40)}`, pct, `${i + 1}/${total}`);
                    }
                    const html = await fetchPage(citPageUrl, apiKey);
                    const doc = parseHTML(html);
                    const pageCitations = parseCitations(doc);
                    if (pageCitations.length === 0) break;
                    pub.citations = pub.citations.concat(pageCitations);

                    // Check for next page link
                    const nextLink = doc.querySelector('.gs_ico_nav_next')?.parentElement;
                    if (nextLink && nextLink.tagName === 'A' && nextLink.href) {
                        const nextHref = nextLink.getAttribute('href');
                        citPageUrl = nextHref.startsWith('http') ? nextHref : `https://scholar.google.com${nextHref}`;
                        await delay(1200);
                    } else {
                        citPageUrl = null;
                    }
                }
            } catch (e) {
                console.warn(`Failed to fetch citations for "${pub.title}":`, e);
                if (!pub.citations) pub.citations = [];
            }
            await delay(1200); // rate limit between citation fetches
        } else {
            pub.citations = [];
        }
    }

    onProgress('Done!', 100);
    return allPubs;
}

/**
 * Fetch citation counts for a list of citing authors via ScraperAPI.
 * Searches Google Scholar for each author to find their profile and total citations.
 * @param {Array} authors - [{ name, institution, ... }]
 * @param {string} apiKey - ScraperAPI key
 * @param {Function} onProgress
 * @returns {Object} { authorName: citationCount }
 */
export async function fetchAuthorCitations(authors, apiKey, onProgress) {
    const results = {};
    const total = authors.length;

    for (let i = 0; i < total; i++) {
        const author = authors[i];
        const pct = Math.round((i / total) * 100);
        onProgress(`Fetching citations for ${truncate(author.name, 30)} (${i + 1}/${total})`, pct);

        try {
            // Search Scholar for the author's profile
            const query = encodeURIComponent(`author:"${author.name}"${author.institution ? ` ${author.institution}` : ''}`);
            const searchUrl = `https://scholar.google.com/citations?view_op=search_authors&mauthors=${query}`;
            const html = await fetchPage(searchUrl, apiKey);
            const doc = parseHTML(html);

            // Look for the first author result
            const profileEl = doc.querySelector('.gs_ai_t');
            if (profileEl) {
                // Citation count is in .gs_ai_cby: "Cited by XXXX"
                const citedByEl = profileEl.querySelector('.gs_ai_cby');
                if (citedByEl) {
                    const match = citedByEl.textContent.match(/(\d[\d,]*)/);
                    if (match) {
                        results[author.name] = parseInt(match[1].replace(/,/g, ''));
                    }
                }
            }
        } catch (e) {
            console.warn(`Failed to fetch citations for ${author.name}:`, e);
        }

        await delay(1000); // rate limit
    }

    return results;
}

function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '...' : str;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
