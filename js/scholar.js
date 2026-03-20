// ── Google Scholar Data Parsing ──
// All scraping is done via the local Selenium server (scraper/server.py).
// This module only contains client-side parsing/aggregation logic.

/**
 * Extract and aggregate co-authors from publications.
 * @param {Array} publications
 * @param {string} researcherName
 * @param {Object} profileInfo - { coauthors: [{ name, affiliation, scholarId }] }
 * @param {Object} scholarProfiles - { scholarId: { fullName, totalCitations, institution } }
 * @returns {Array} sorted by paperCount desc: { name, paperCount, papers[] }
 */
export function parseCoAuthors(publications, researcherName, profileInfo = {}, scholarProfiles = {}) {
    const coauthorMap = {};
    const researcherLower = (researcherName || '').toLowerCase().trim();
    const researcherParts = researcherLower ? researcherLower.split(/\s+/) : [];

    // Build a lookup: abbreviated name → full name from profileInfo.coauthors + scholarProfiles
    const fullNameLookup = {};  // "R Krishnan" → "Ramayya Krishnan"
    // From profileInfo coauthors (most reliable for the researcher's own co-authors)
    for (const ca of (profileInfo.coauthors || [])) {
        if (ca.name && ca.scholarId) {
            // Map scholarId to full name
            fullNameLookup[ca.scholarId] = ca.name;
        }
    }

    for (const pub of publications) {
        if (!pub.authors) continue;
        const names = pub.authors.split(',').map(n => n.trim()).filter(Boolean);

        for (const name of names) {
            // Skip the researcher themselves (fuzzy match, only if name is set)
            if (researcherParts.length > 0) {
                const nameLower = name.toLowerCase();
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

            // Try to resolve abbreviated name to full name
            const displayName = resolveFullName(name, profileInfo, scholarProfiles) || name;

            if (!coauthorMap[displayName]) {
                coauthorMap[displayName] = { name: displayName, paperCount: 0, papers: [] };
            }
            coauthorMap[displayName].paperCount++;
            coauthorMap[displayName].papers.push(pub.title);
        }
    }

    return Object.values(coauthorMap).sort((a, b) => b.paperCount - a.paperCount);
}

/**
 * Resolve an abbreviated name (e.g. "R Krishnan") to a full name
 * using profileInfo coauthors and scholarProfiles.
 */
function resolveFullName(abbrevName, profileInfo = {}, scholarProfiles = {}) {
    const parts = abbrevName.trim().split(/\s+/);
    if (parts.length < 2) return null;

    const lastName = parts[parts.length - 1].toLowerCase();
    const firstPart = parts[0].toLowerCase();

    // Check profileInfo coauthors first (most accurate for own co-authors)
    for (const ca of (profileInfo.coauthors || [])) {
        const caParts = ca.name.split(/\s+/);
        if (caParts.length < 2) continue;
        const caLast = caParts[caParts.length - 1].toLowerCase();
        const caFirst = caParts[0].toLowerCase();
        if (caLast === lastName && caFirst.startsWith(firstPart)) {
            return ca.name;
        }
    }

    // Check scholarProfiles
    for (const profile of Object.values(scholarProfiles)) {
        if (!profile.fullName) continue;
        const pParts = profile.fullName.split(/\s+/);
        if (pParts.length < 2) continue;
        const pLast = pParts[pParts.length - 1].toLowerCase();
        const pFirst = pParts[0].toLowerCase();
        if (pLast === lastName && pFirst.startsWith(firstPart)) {
            return profile.fullName;
        }
    }

    return null;
}

/**
 * Aggregate citing authors from publication citations + geoData.
 * @param {Array} publications
 * @param {Object} geoData - { "pubIdx_citIdx": { country, institution } }
 * @param {boolean} firstAuthorOnly - if true, only count first author; if false, count all authors
 * @param {Object} scholarProfiles - { scholarId: { fullName, totalCitations, institution } }
 * @returns {Array} sorted by citCount desc: { name, citCount, institution, country, papers[] }
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
                            citedPublications: [],
                        };
                    }
                    authorMap[displayName].citCount++;
                    authorMap[displayName].papers.push(cit.title);
                    // Track which parent publication this citation refers to
                    if (pub.title && !authorMap[displayName].citedPublications.includes(pub.title)) {
                        authorMap[displayName].citedPublications.push(pub.title);
                    }
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
                        citedPublications: [],
                    };
                }
                authorMap[displayName].citCount++;
                authorMap[displayName].papers.push(cit.title);
                if (pub.title && !authorMap[displayName].citedPublications.includes(pub.title)) {
                    authorMap[displayName].citedPublications.push(pub.title);
                }
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
