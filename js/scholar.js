// ── Google Scholar Scraping via ScraperAPI ──

const SCRAPER_BASE = 'https://api.scraperapi.com';

function scraperUrl(targetUrl, apiKey) {
    return `${SCRAPER_BASE}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}&render=false`;
}

async function fetchPage(url, apiKey, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const resp = await fetch(scraperUrl(url, apiKey));
            if (resp.status === 429) {
                // Rate limited — wait longer before retry
                const wait = 5000 * attempt;
                console.warn(`Rate limited (429), waiting ${wait / 1000}s before retry ${attempt}/${maxRetries}`);
                await delay(wait);
                continue;
            }
            if (!resp.ok) throw new Error(`ScraperAPI error ${resp.status}: ${resp.statusText}`);
            const html = await resp.text();
            // Check for Scholar's "try again later" block
            if (html.includes("can\u0027t perform the operation now") || html.includes("unusual traffic")) {
                if (attempt < maxRetries) {
                    const wait = 4000 * attempt;
                    console.warn(`Scholar blocked, waiting ${wait / 1000}s before retry ${attempt}/${maxRetries}`);
                    await delay(wait);
                    continue;
                }
            }
            return html;
        } catch (e) {
            if (attempt === maxRetries) throw e;
            const wait = 3000 * attempt;
            console.warn(`Fetch failed, waiting ${wait / 1000}s before retry ${attempt}/${maxRetries}: ${e.message}`);
            await delay(wait);
        }
    }
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
    const researcherLower = (researcherName || '').toLowerCase().trim();
    const researcherParts = researcherLower ? researcherLower.split(/\s+/) : [];

    for (const pub of publications) {
        if (!pub.authors) continue;
        const names = pub.authors.split(',').map(n => n.trim()).filter(Boolean);

        for (const name of names) {
            // Skip the researcher themselves (fuzzy match, only if name is set)
            if (researcherParts.length > 0) {
                const nameLower = name.toLowerCase();
                // Check if abbreviated name matches (e.g., "Y Li" matches "Yubo Li")
                const nameParts = nameLower.split(/\s+/);
                const lastNameMatch = nameParts.length > 0 && researcherParts.includes(nameParts[nameParts.length - 1]);
                const firstInitialMatch = nameParts.length > 0 && researcherParts.some(p => p.startsWith(nameParts[0]));
                const isResearcher = researcherParts.every(p => nameLower.includes(p))
                    || nameLower === researcherLower
                    || (lastNameMatch && firstInitialMatch);
                if (isResearcher) continue;
            }

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
 * @param {Object} scholarProfiles - { scholarId: { fullName, totalCitations, institution } }
 */
export function parseCitingAuthors(publications, geoData = {}, firstAuthorOnly = true, scholarProfiles = {}) {
    const authorMap = {};

    for (let pi = 0; pi < publications.length; pi++) {
        const pub = publications[pi];
        if (!pub.citations) continue;

        for (let ci = 0; ci < pub.citations.length; ci++) {
            const cit = pub.citations[ci];
            const geo = geoData[`${pi}_${ci}`] || {};

            // New format: use authorList if available (from Selenium scraper)
            if (cit.authorList && cit.authorList.length > 0) {
                const authors = firstAuthorOnly
                    ? cit.authorList.filter(a => a.isFirstAuthor).slice(0, 1)
                    : cit.authorList;

                // If no first author flagged, use first entry
                const effectiveAuthors = authors.length > 0 ? authors : [cit.authorList[0]];

                for (const author of effectiveAuthors) {
                    const sid = author.scholarId || '';
                    const profile = sid ? (scholarProfiles[sid] || {}) : {};
                    // Use full name from profile if available, otherwise abbreviated
                    const displayName = profile.fullName || author.name;
                    if (!displayName) continue;

                    if (!authorMap[displayName]) {
                        authorMap[displayName] = {
                            name: displayName,
                            citCount: 0,
                            authorCitations: profile.totalCitations || 0,
                            scholarId: sid,
                            institution: profile.institution || geo.institution || '',
                            country: geo.country || '',
                            isFirstAuthor: author.isFirstAuthor || false,
                            papers: [],
                        };
                    }
                    authorMap[displayName].citCount++;
                    authorMap[displayName].papers.push(cit.title);
                    // Update institution/country if we get better data
                    if (profile.institution && !authorMap[displayName].institution) {
                        authorMap[displayName].institution = profile.institution;
                    }
                    if (profile.totalCitations && !authorMap[displayName].authorCitations) {
                        authorMap[displayName].authorCitations = profile.totalCitations;
                    }
                    if (geo.country && !authorMap[displayName].country) {
                        authorMap[displayName].country = geo.country;
                    }
                }
                continue;
            }

            // Legacy format: parse from author strings
            if (!cit.authors && !cit.fullAuthors) continue;

            const authorString = cit.fullAuthors || cit.authors || '';
            const allNames = authorString.split(',').map(n => n.trim()).filter(n => {
                if (!n || n === '...' || n === '…') return false;
                if (/^\d{4}$/.test(n)) return false;
                if (/arXiv|preprint|proceedings|journal|conference|IEEE|ACM|springer|elsevier|wiley/i.test(n)) return false;
                if (!/[a-zA-Z]/.test(n)) return false;
                if (n.length > 40) return false;
                return true;
            });
            const names = firstAuthorOnly ? allNames.slice(0, 1) : allNames;
            const profiles = cit.authorProfiles || {};

            for (const name of names) {
                const sid = profiles[name] || '';
                const profile = sid ? (scholarProfiles[sid] || {}) : {};
                const displayName = profile.fullName || name;

                if (!authorMap[displayName]) {
                    authorMap[displayName] = {
                        name: displayName,
                        citCount: 0,
                        authorCitations: profile.totalCitations || 0,
                        scholarId: sid,
                        institution: profile.institution || geo.institution || '',
                        country: geo.country || '',
                        papers: [],
                    };
                }
                authorMap[displayName].citCount++;
                authorMap[displayName].papers.push(cit.title);
                if (profile.institution && !authorMap[displayName].institution) {
                    authorMap[displayName].institution = profile.institution;
                }
                if (profile.totalCitations && !authorMap[displayName].authorCitations) {
                    authorMap[displayName].authorCitations = profile.totalCitations;
                }
                if (geo.country && !authorMap[displayName].country) {
                    authorMap[displayName].country = geo.country;
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
        const titleLink = r.querySelector('.gs_rt a');
        const titleEl = titleLink || r.querySelector('.gs_rt');
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

        citations.push({ title, authors, year, link, venue, publisher, authorProfiles, fullAuthors: '' });
    }
    return citations;
}

/**
 * Fetch the full author list from a citing paper's page.
 * Tries meta tags from publisher sites, then Scholar detail page fields.
 */
async function fetchFullAuthors(paperUrl, apiKey) {
    if (!paperUrl) return '';
    // Normalize relative Scholar URLs
    const url = paperUrl.startsWith('/') ? `https://scholar.google.com${paperUrl}` : paperUrl;
    try {
        const html = await fetchPage(url, apiKey);
        const doc = parseHTML(html);

        // Method 1: single "citation_authors" meta tag (comma-separated)
        const metaPlural = doc.querySelector('meta[name="citation_authors"]');
        if (metaPlural) {
            const content = metaPlural.getAttribute('content')?.trim();
            if (content) return content;
        }

        // Method 2: multiple "citation_author" meta tags (one per author)
        const authorMetas = doc.querySelectorAll('meta[name="citation_author"]');
        if (authorMetas.length > 0) {
            return Array.from(authorMetas).map(m => m.getAttribute('content')?.trim()).filter(Boolean).join(', ');
        }

        // Method 3: Scholar paper detail page (#gsc_oci_table)
        const fields = doc.querySelectorAll('#gsc_oci_table .gs_scl');
        for (const field of fields) {
            const label = field.querySelector('.gsc_oci_field')?.textContent?.trim();
            if (label === 'Authors' || label === 'Inventors') {
                return field.querySelector('.gsc_oci_value')?.textContent?.trim() || '';
            }
        }

        return '';
    } catch (e) {
        console.warn(`Failed to fetch full authors from ${url}:`, e);
        return '';
    }
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
        if (pageUrl) await delay(2000); // rate limit
    }

    onProgress(`Found ${allPubs.length} publications. Fetching citations...`, 20);

    // Fetch citations for each publication
    const total = allPubs.length;
    for (let i = 0; i < total; i++) {
        const pub = allPubs[i];
        const pct = 20 + Math.round((i / total) * 70);

        // Skip if already cached AND citations are fully fetched AND have full author names
        if (cachedPubs[pub.title]) {
            const cached = cachedPubs[pub.title];
            const cachedCitCount = (cached.citations || []).length;
            const hasFullAuthors = (cached.citations || []).every(c => c.fullAuthors);
            // Re-fetch if cached citations are incomplete or missing full authors
            if ((cachedCitCount >= pub.citationCount || pub.citationCount === 0) && hasFullAuthors) {
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
                        await delay(2500);
                    } else {
                        citPageUrl = null; // fewer than 10 results = last page
                    }
                }
            } catch (e) {
                console.warn(`Failed to fetch citations for "${pub.title}":`, e);
                if (!pub.citations) pub.citations = [];
            }
            await delay(2500); // rate limit between citation fetches
        } else {
            pub.citations = [];
        }
    }

    // Fetch full author names for all citations that don't have them yet
    onProgress('Fetching full author names for citing papers...', 92);
    let fetchedCount = 0;
    let totalCitations = 0;
    for (const pub of allPubs) {
        for (const cit of (pub.citations || [])) {
            if (!cit.fullAuthors && cit.link) totalCitations++;
        }
    }

    for (let i = 0; i < allPubs.length; i++) {
        const pub = allPubs[i];
        for (let ci = 0; ci < (pub.citations || []).length; ci++) {
            const cit = pub.citations[ci];
            if (cit.fullAuthors || !cit.link) continue; // already have full names or no link

            fetchedCount++;
            const pctBase = 92 + Math.round((fetchedCount / Math.max(totalCitations, 1)) * 7);
            onProgress(`Fetching authors (${fetchedCount}/${totalCitations}): ${truncate(cit.title, 40)}`, pctBase);

            const fullAuthors = await fetchFullAuthors(cit.link, apiKey);
            if (fullAuthors) {
                cit.fullAuthors = fullAuthors;
            }
            await delay(800);
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
                // Search for author by name (+ institution if available) on Google Scholar profiles
                const searchQuery = author.institution
                    ? `${author.name} ${author.institution}`
                    : author.name;
                const searchUrl = `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(searchQuery)}&hl=en`;
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
