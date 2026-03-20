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
/**
 * @param {boolean} firstAuthorOnly - if true, only count first author; if false, count all authors
 */
export function parseCitingAuthors(publications, geoData = {}, firstAuthorOnly = true) {
    const authorMap = {};

    for (let pi = 0; pi < publications.length; pi++) {
        const pub = publications[pi];
        if (!pub.citations) continue;

        for (let ci = 0; ci < pub.citations.length; ci++) {
            const cit = pub.citations[ci];
            if (!cit.authors) continue;

            const geo = geoData[`${pi}_${ci}`] || {};

            // Get author names to process — filter out non-name entries
            const allNames = cit.authors.split(',').map(n => n.trim()).filter(n => {
                if (!n || n === '...' || n === '…') return false;
                // Filter out years (e.g. "2025", "2026")
                if (/^\d{4}$/.test(n)) return false;
                // Filter out entries containing venue/journal text
                if (/arXiv|preprint|proceedings|journal|conference|IEEE|ACM|springer|elsevier|wiley/i.test(n)) return false;
                // Must look like a name: at least one letter
                if (!/[a-zA-Z]/.test(n)) return false;
                // Filter out very long entries (likely venue text, not names)
                if (n.length > 40) return false;
                return true;
            });
            const names = firstAuthorOnly ? allNames.slice(0, 1) : allNames;

            const profiles = cit.authorProfiles || {};

            for (const name of names) {
                if (!authorMap[name]) {
                    authorMap[name] = {
                        name,
                        citCount: 0,
                        authorCitations: 0,
                        scholarId: profiles[name] || '',
                        institution: geo.institution || '',
                        country: geo.country || '',
                        papers: [],
                    };
                }
                authorMap[name].citCount++;
                authorMap[name].papers.push(cit.title);
                // Keep scholar profile ID if found
                if (profiles[name] && !authorMap[name].scholarId) {
                    authorMap[name].scholarId = profiles[name];
                }
                if (geo.institution && !authorMap[name].institution) {
                    authorMap[name].institution = geo.institution;
                }
                if (geo.country && !authorMap[name].country) {
                    authorMap[name].country = geo.country;
                }
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
        // Handle various dash types (hyphen, en-dash, em-dash, with optional nbsp)
        const parts = authorText.split(/\s*[\u002D\u2010\u2011\u2012\u2013\u2014\u00A0]+-\s*|\s+-\s+|\s+\u2013\s+|\s+\u2014\s+/);
        if (parts.length === 1) {
            // Fallback: split by " - " with flexible whitespace
            const fallbackParts = authorText.split(/\s*-\s*/);
            if (fallbackParts.length > 1) {
                parts.length = 0;
                parts.push(...fallbackParts);
            }
        }
        const authors = (parts[0] || '').trim();
        const venue = (parts[1] || '').replace(/,?\s*\d{4}.*/, '').trim();
        const publisher = (parts[2] || '').trim();
        const yearMatch = authorText.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : 0;

        const link = titleEl.tagName === 'A' ? titleEl.getAttribute('href') : '';

        // Extract author profile links (Scholar user IDs)
        const authorProfiles = {};
        if (authorEl) {
            const profileAnchors = authorEl.querySelectorAll('a[href*="/citations?user="]');
            for (const a of profileAnchors) {
                const aName = a.textContent.trim();
                const aHref = a.getAttribute('href') || '';
                const userMatch = aHref.match(/user=([^&]+)/);
                if (aName && userMatch) {
                    authorProfiles[aName] = userMatch[1];
                }
            }
        }

        citations.push({ title, authors, year, link, venue, publisher, authorProfiles });
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

        // Skip if already cached AND citations are fully fetched
        if (cachedPubs[pub.title]) {
            const cached = cachedPubs[pub.title];
            const cachedCitCount = (cached.citations || []).length;
            // Re-fetch if cached citations are incomplete (less than expected)
            if (cachedCitCount >= pub.citationCount || pub.citationCount === 0) {
                pub.citations = cached.citations || [];
                onProgress(`Skipping cached: ${truncate(pub.title, 50)}`, pct, `${i + 1}/${total}`);
                continue;
            }
            // Otherwise fall through to re-fetch with pagination
        }

        if (pub.citedByUrl && pub.citationCount > 0) {
            onProgress(`Fetching citations for: ${truncate(pub.title, 50)}`, pct, `${i + 1}/${total}`);
            try {
                pub.citations = [];
                let citPageUrl = pub.citedByUrl;
                let citPage = 0;

                // Paginate through all "Cited by" pages (10 results per page)
                const maxPages = Math.ceil(pub.citationCount / 10);
                while (citPageUrl && citPage < maxPages) {
                    citPage++;
                    if (citPage > 1) {
                        onProgress(`Fetching citations p${citPage}/${maxPages} for: ${truncate(pub.title, 35)}`, pct, `${i + 1}/${total}`);
                    }
                    const html = await fetchPage(citPageUrl, apiKey);
                    const doc = parseHTML(html);
                    const pageCitations = parseCitations(doc);
                    if (pageCitations.length === 0) break;
                    pub.citations = pub.citations.concat(pageCitations);

                    // Build next page URL using &start= parameter
                    if (pageCitations.length >= 10) {
                        const startParam = citPage * 10;
                        // Base cited-by URL may already have params
                        const baseUrl = pub.citedByUrl.split('&start=')[0];
                        citPageUrl = `${baseUrl}&start=${startParam}`;
                        await delay(1200);
                    } else {
                        citPageUrl = null; // fewer than 10 results = last page
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

    if (total === 0) {
        onProgress('No authors to look up.', 100);
        await delay(1000);
        return results;
    }

    for (let i = 0; i < total; i++) {
        const author = authors[i];
        const pct = Math.round((i / total) * 100);
        onProgress(`Looking up ${truncate(author.name, 25)} (${i + 1}/${total})`, pct);

        try {
            if (author.scholarId) {
                // Direct profile fetch if we have the Scholar ID
                const profileUrl = `https://scholar.google.com/citations?user=${author.scholarId}&hl=en`;
                const html = await fetchPage(profileUrl, apiKey);
                const doc = parseHTML(html);
                const totalCit = parseProfileCitations(doc);
                if (totalCit > 0) results[author.name] = totalCit;
            } else {
                // Search for author by name on Google Scholar profiles
                const searchUrl = `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(author.name)}&hl=en`;
                const html = await fetchPage(searchUrl, apiKey);
                const doc = parseHTML(html);

                // Find the first matching profile
                const profileEl = doc.querySelector('.gsc_1usr');
                if (profileEl) {
                    // Extract citation count directly from search results
                    const citEl = profileEl.querySelector('.gs_ai_cby');
                    if (citEl) {
                        const citMatch = citEl.textContent.match(/(\d[\d,]*)/);
                        if (citMatch) {
                            const totalCit = parseInt(citMatch[1].replace(/,/g, '')) || 0;
                            if (totalCit > 0) results[author.name] = totalCit;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`Failed to look up ${author.name}:`, e);
        }

        await delay(800); // rate limit
    }

    return results;
}

function parseProfileCitations(doc) {
    const statCells = doc.querySelectorAll('#gsc_rsb_st td.gsc_rsb_std');
    if (statCells.length > 0) {
        return parseInt(statCells[0]?.textContent?.replace(/,/g, '')) || 0;
    }
    return 0;
}

function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '...' : str;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
