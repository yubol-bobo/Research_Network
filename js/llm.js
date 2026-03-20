// ── LLM API Integration (OpenAI, Claude, Gemini) ──

const THEME_COLORS = [
    '#6366f1', '#a855f7', '#06b6d4', '#22c55e', '#eab308',
    '#f97316', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6',
    '#3b82f6', '#84cc16', '#f43f5e', '#0ea5e9', '#d946ef',
];

/**
 * Call the selected LLM provider.
 * @param {string} provider - 'openai' | 'claude' | 'gemini'
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @returns {string} response text
 */
async function callLLM(provider, apiKey, model, prompt) {
    if (provider === 'openai') {
        return await callOpenAI(apiKey, model || 'gpt-4o-mini', prompt);
    } else if (provider === 'claude') {
        return await callClaude(apiKey, model || 'claude-sonnet-4-20250514', prompt);
    } else if (provider === 'gemini') {
        return await callGemini(apiKey, model || 'gemini-pro', prompt);
    }
    throw new Error(`Unknown LLM provider: ${provider}`);
}

async function callOpenAI(apiKey, model, prompt) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
        }),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`OpenAI API error ${resp.status}: ${err}`);
    }
    const data = await resp.json();
    return data.choices[0].message.content;
}

async function callClaude(apiKey, model, prompt) {
    // Note: Claude API requires server-side calls due to CORS.
    // We use a CORS proxy approach or the user needs to handle this.
    // For direct browser use, we'll try the API directly.
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model,
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Claude API error ${resp.status}: ${err}`);
    }
    const data = await resp.json();
    return data.content[0].text;
}

async function callGemini(apiKey, model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
        }),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gemini API error ${resp.status}: ${err}`);
    }
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
}

/**
 * Summarize publications and cluster them into themes.
 * @param {Array} publications
 * @param {Object} config - { llmProvider, llmKey, llmModel }
 * @param {Function} onProgress
 * @returns {{ summaries: Object, themes: Object }}
 */
export async function analyzePapers(publications, config, onProgress) {
    if (!config.llmKey) {
        return { summaries: {}, themes: {} };
    }

    const titles = publications.map((p, i) => `${i + 1}. ${p.title} (${p.year})`).join('\n');

    // ── Step 1: Cluster into themes ──
    onProgress('Clustering publications into themes...', 92);

    const clusterPrompt = `You are a research analyst. Given these academic publication titles, categorize them into broad, high-level research disciplines.

Use broad categories like: Healthcare, Economics, NLP, Computer Vision, Reinforcement Learning, Operations Research, Robotics, Finance, Education, Climate Science, Cybersecurity, Bioinformatics, Social Science, Materials Science, etc.

Do NOT create narrow or paper-specific themes. Each theme should be a well-known academic field or discipline that a general audience would recognize. Aim for 3-7 broad themes total.

Publications:
${titles}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "themes": [
    { "name": "Theme Name", "publications": [1, 3, 5] }
  ]
}

Where the numbers are the publication indices (1-based). Every publication must be assigned to exactly one theme.`;

    let themes = {};
    try {
        const clusterResp = await callLLM(config.llmProvider, config.llmKey, config.llmModel, clusterPrompt);
        const clusterData = JSON.parse(clusterResp.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

        if (clusterData.themes) {
            clusterData.themes.forEach((t, ti) => {
                const color = THEME_COLORS[ti % THEME_COLORS.length];
                for (const idx of t.publications) {
                    const pub = publications[idx - 1];
                    if (pub) {
                        themes[pub.title] = { theme: t.name, color };
                    }
                }
            });
        }
    } catch (e) {
        console.warn('LLM clustering failed:', e);
    }

    // ── Step 2: Summarize papers ──
    onProgress('Generating paper summaries...', 96);

    const summaryPrompt = `You are a research analyst. For each publication title below, write a brief 1-sentence summary describing what the paper likely investigates or contributes.

Publications:
${titles}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "summaries": {
    "1": "One sentence summary for paper 1",
    "2": "One sentence summary for paper 2"
  }
}`;

    let summaries = {};
    try {
        const sumResp = await callLLM(config.llmProvider, config.llmKey, config.llmModel, summaryPrompt);
        const sumData = JSON.parse(sumResp.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

        if (sumData.summaries) {
            for (const [idx, summary] of Object.entries(sumData.summaries)) {
                const pub = publications[parseInt(idx) - 1];
                if (pub) {
                    summaries[pub.title] = summary;
                }
            }
        }
    } catch (e) {
        console.warn('LLM summarization failed:', e);
    }

    return { summaries, themes };
}

/**
 * Extract country/institution info for citing papers using LLM.
 * Processes in batches to stay within token limits.
 * @param {Array} publications - array with .citations
 * @param {Object} config - { llmProvider, llmKey, llmModel }
 * @param {Function} onProgress
 * @returns {Object} geoData - { "pubIdx_citIdx": { country, institution } }
 */
export async function extractCitationGeo(publications, config, onProgress) {
    if (!config.llmKey) return {};

    // Collect all citations with their indices
    const allCitations = [];
    for (let pi = 0; pi < publications.length; pi++) {
        const pub = publications[pi];
        if (!pub.citations) continue;
        for (let ci = 0; ci < pub.citations.length; ci++) {
            const cit = pub.citations[ci];
            allCitations.push({
                key: `${pi}_${ci}`,
                title: cit.title,
                authors: cit.fullAuthors || cit.authors || '',
                venue: cit.venue || '',
                publisher: cit.publisher || '',
            });
        }
    }

    if (allCitations.length === 0) return {};

    const geoData = {};
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(allCitations.length / BATCH_SIZE);

    for (let b = 0; b < totalBatches; b++) {
        const batch = allCitations.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        const pct = 85 + Math.round((b / totalBatches) * 10);
        onProgress(`Extracting geolocation (batch ${b + 1}/${totalBatches})...`, pct);

        const citList = batch.map((c, i) =>
            `${i + 1}. "${c.title}" by ${c.authors}${c.venue ? ` — ${c.venue}` : ''}${c.publisher ? ` (${c.publisher})` : ''}`
        ).join('\n');

        const geoPrompt = `You are an academic research analyst. For each citing paper below, infer the most likely country and institution of the first author based on the author names, venue, and publisher info.

Use your knowledge of academic institutions, common name origins, and publication venues to make your best guess. If uncertain, make your best inference — do not leave blanks.

Citations:
${citList}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "results": {
    "1": { "country": "United States", "institution": "MIT" },
    "2": { "country": "China", "institution": "Tsinghua University" }
  }
}

Use standard English country names (e.g. "United States", "United Kingdom", "South Korea", "China").
IMPORTANT: Taiwan is part of China. Always use "China" for institutions in Taiwan, Hong Kong, or Macau.`;

        try {
            const resp = await callLLM(config.llmProvider, config.llmKey, config.llmModel, geoPrompt);
            const parsed = JSON.parse(resp.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

            if (parsed.results) {
                for (const [idx, info] of Object.entries(parsed.results)) {
                    const citEntry = batch[parseInt(idx) - 1];
                    if (citEntry && info.country) {
                        geoData[citEntry.key] = {
                            country: info.country,
                            institution: info.institution || '',
                        };
                    }
                }
            }
        } catch (e) {
            console.warn(`LLM geo extraction batch ${b + 1} failed:`, e);
        }
    }

    return geoData;
}

/**
 * Clean institution names using LLM — extract just the university/organization name.
 * e.g. "PhD student, Department of CS, The Chinese University of Hong Kong"
 *    → "The Chinese University of Hong Kong"
 *
 * @param {Object} scholarProfiles - { scholarId: { fullName, institution, ... } }
 * @param {Object} config - { llmProvider, llmKey, llmModel }
 * @param {Function} onProgress
 * @returns {Object} updated scholarProfiles with cleaned institution names
 */
export async function cleanInstitutions(scholarProfiles, config, onProgress) {
    // Collect unique raw institutions
    const rawInstitutions = new Set();
    for (const profile of Object.values(scholarProfiles)) {
        if (profile.institution && profile.institution.length > 0) {
            rawInstitutions.add(profile.institution);
        }
    }

    if (rawInstitutions.size === 0) return scholarProfiles;

    const uniqueList = [...rawInstitutions];
    const cleanMap = {}; // raw → cleaned

    // Batch in groups of 30
    const batchSize = 30;
    const totalBatches = Math.ceil(uniqueList.length / batchSize);

    for (let b = 0; b < totalBatches; b++) {
        const batch = uniqueList.slice(b * batchSize, (b + 1) * batchSize);
        const pct = Math.round((b / totalBatches) * 100);
        onProgress(`Cleaning institution names (${b + 1}/${totalBatches})...`, pct);

        const prompt = `Extract ONLY the university or organization name from each institution string below. Remove titles (PhD student, Professor, etc.), departments, and descriptions. Keep just the institution/university name.

Examples:
- "PhD student, Department of Computer Science and Engineering, The Chinese University of Hong Kong" → "The Chinese University of Hong Kong"
- "PhD Candidate of Computer Science, University of California, Santa Cruz" → "University of California, Santa Cruz"
- "Associate Professor, School of Computing, National University of Singapore" → "National University of Singapore"
- "Research Scientist at Google DeepMind" → "Google DeepMind"
- "Postdoc @ ENS-PSL & CNRS-LATTICE" → "ENS-PSL & CNRS-LATTICE"
- "Professor and Head of CSE department, Qatar University" → "Qatar University"
- "Founder & CEO, DeepWisdom" → "DeepWisdom"
- "Master of Statistics, The University of Hong Kong" → "The University of Hong Kong"
- "Carnegie Mellon University" → "Carnegie Mellon University"

Return ONLY a JSON object mapping each input string to the cleaned institution name:
${JSON.stringify(Object.fromEntries(batch.map((inst, i) => [String(i + 1), inst])), null, 1)}

Respond with JSON: { "1": "cleaned name", "2": "cleaned name", ... }`;

        try {
            const resp = await callLLM(config.llmProvider, config.llmKey, config.llmModel, prompt);
            const parsed = JSON.parse(resp.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

            for (const [idx, cleaned] of Object.entries(parsed)) {
                const rawInst = batch[parseInt(idx) - 1];
                if (rawInst && cleaned) {
                    cleanMap[rawInst] = cleaned;
                }
            }
        } catch (e) {
            console.warn(`Institution cleaning batch ${b + 1} failed:`, e);
        }
    }

    // Apply cleaned names to profiles
    const updated = { ...scholarProfiles };
    for (const [sid, profile] of Object.entries(updated)) {
        if (profile.institution && cleanMap[profile.institution]) {
            updated[sid] = { ...profile, institution: cleanMap[profile.institution] };
        }
    }

    return updated;
}
