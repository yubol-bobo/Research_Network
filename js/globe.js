// ── 3D Globe Visualization using globe.gl ──
// Countries light up based on citation count (brighter = more citations)

import { cleanInstitution } from './scholar-view.js';

let globeInstance = null;
let geoJsonData = null; // cached country polygons

// Country name normalization map (GeoJSON name → common names used by LLM)
const COUNTRY_NAME_ALIASES = {
    'United States of America': ['United States', 'USA', 'US'],
    'United Kingdom': ['UK', 'Great Britain', 'England'],
    'South Korea': ['Korea, Republic of', 'Republic of Korea'],
    'North Korea': ["Korea, Democratic People's Republic of"],
    'Czech Republic': ['Czechia'],
    'Russian Federation': ['Russia'],
    'Iran (Islamic Republic of)': ['Iran'],
    'Syrian Arab Republic': ['Syria'],
    'Venezuela (Bolivarian Republic of)': ['Venezuela'],
    'Bolivia (Plurinational State of)': ['Bolivia'],
    'Tanzania, United Republic of': ['Tanzania'],
    'Viet Nam': ['Vietnam'],
    'Lao People\'s Democratic Republic': ['Laos'],
    'Republic of the Congo': ['Congo'],
    'Dem. Rep. Congo': ['Democratic Republic of the Congo', 'DRC'],
    'Côte d\'Ivoire': ['Ivory Coast'],
    'Brunei Darussalam': ['Brunei'],
};

/**
 * Build a reverse lookup: any alias → canonical GeoJSON name
 */
function buildAliasMap() {
    const map = {};
    for (const [geoName, aliases] of Object.entries(COUNTRY_NAME_ALIASES)) {
        for (const alias of aliases) {
            map[alias.toLowerCase()] = geoName;
        }
        map[geoName.toLowerCase()] = geoName;
    }
    return map;
}

const aliasMap = buildAliasMap();

// ── Country Inference Engine ──
// Three-tier approach for maximum generalizability:
// 1. Specific institution/company patterns (high precision)
// 2. Country name mentioned directly in institution string
// 3. Major city name fallback

// Tier 1: Well-known institutions & companies → country
const INSTITUTION_PATTERNS = [
    // US
    [/Carnegie Mellon|Stanford|MIT\b|Harvard|Berkeley|Caltech|Princeton|Yale|Columbia|Cornell|University of (California|Michigan|Washington|Pennsylvania|Illinois|Texas|Wisconsin|Virginia|Maryland|Florida|Georgia|Colorado|Arizona|Oregon|Minnesota|Indiana|Iowa|Massachusetts|North Carolina|South Carolina|Chicago|Pittsburgh|Rochester|Notre Dame|Southern California|Central Florida|Utah|Kentucky|Kansas|Nebraska|Hawaii|Tennessee|Missouri|Oklahoma|Cincinnati|Delaware|Nevada|New Mexico|Vermont|Connecticut|Rhode Island|New Hampshire|Maine|Montana|Idaho|Wyoming|Alabama|Mississippi|Arkansas|Louisiana|West Virginia)|Georgia (Tech|Institute)|Johns Hopkins|Duke|Northwestern|Rice|Emory|Vanderbilt|Brown|Dartmouth|Penn(sylvania)? State|Ohio State|Purdue|Michigan State|Arizona State|USC\b|UCLA|UCSB|UCSD|UCSC|UC Davis|UC Irvine|Case Western|Stony Brook|Rutgers|NYU\b|Boston University|Rochester|Syracuse|Drexel|Tulane|Lehigh|CMU\b|UIUC|UMass|UConn|UMD\b|UVA\b|UNC\b|UT Austin|UT Dallas|SUNY|Northeastern University|Georgetown|Wake Forest|Tufts|Brandeis|George Washington|American University|Temple|Villanova|Fordham|IBM Research|Google|Microsoft|Meta\b|Amazon|OpenAI|NVIDIA|Apple\b|Adobe|Salesforce|Intel\b|Qualcomm|Oracle/i, 'United States'],
    // China (including Hong Kong, Macau, Taiwan)
    [/Tsinghua|Peking University|Fudan|Zhejiang|Shang\s*hai|Nanjing|Wuhan|Huazhong|Sun Yat|Harbin|USTC|ECNU|East China|CAS\b|Chinese Academy|Science and Technology of China|Beihang|Beijing|Renmin|Sichuan|Jilin|Tongji|Xiamen|Nankai|Southeast University|Central South|SJTU|HUST|Zhengzhou|Shandong|Tianjin|Dalian|Xidian|Northwestern Polytechnical|Southwest Jiaotong|Tencent|Baidu|Alibaba|ByteDance|Huawei|Xiaomi|JD\b|DiDi|SenseTime|Megvii|CUHK\b|Hong Kong|HKUST|HKU\b|Lingnan|National Taiwan|NTHU|NCTU|Academia Sinica/i, 'China'],
    // UK
    [/Oxford|Cambridge|Imperial College|UCL\b|University College of London|Edinburgh|Manchester|Bristol|Warwick|Glasgow|Leeds|Sheffield|Southampton|Birmingham|Liverpool|Nottingham|Queen Mary|King.s College|LSE|London School|St Andrews|Durham|Exeter|Bath|York|Sussex|Surrey|Lancaster|Leicester|Aberdeen|Heriot|Newcastle|Reading|Cardiff|Swansea|Hertfordshire|Kent|Essex|Cranfield|Brunel|Plymouth|Portsmouth|Stirling|Strathclyde|Dundee|Aston|Keele|Bangor|Ulster|Brighton|Coventry/i, 'United Kingdom'],
    // Switzerland (before Germany — ETH is Swiss)
    [/ETH\b|EPFL|Zurich|Zürich|Geneva|Basel|Bern|Lausanne|IDIAP/i, 'Switzerland'],
    // Germany
    [/Munich|TU Berlin|Heidelberg|Bonn|Freiburg|Hamburg|Frankfurt|Stuttgart|Leipzig|Göttingen|Tübingen|RWTH|Karlsruhe|TU Darmstadt|Saarland|Max Planck|Fraunhofer|Humboldt|Dresden|Siemens|Siegen|Mannheim|Bielefeld|Potsdam|Konstanz|Rostock|Jena|Mainz|Würzburg/i, 'Germany'],
    // Canada
    [/Toronto|McGill|UBC\b|Waterloo|Montreal|Montréal|Alberta|Ottawa|Calgary|Simon Fraser|McMaster|Dalhousie|Manitoba|Saskatchewan|Laval|Mila\b|Vector Institute|CIFAR|Concordia/i, 'Canada'],
    // France
    [/Sorbonne|ENS\b|Ecole Polytechnique|INRIA|CNRS|Paris|Grenoble|Lyon|Toulouse|Marseille|Strasbourg|Bordeaux|Lille|Nantes|CentraleSupélec|Télécom|Sciences Po|HEC\b|INSEAD/i, 'France'],
    // Japan
    [/Tokyo|Kyoto|Osaka|Tohoku|Nagoya|Hokkaido|Kyushu|Waseda|Keio|Tsukuba|NAIST|NICT|RIKEN|NTT\b|Sony|Hitachi|Fujitsu/i, 'Japan'],
    // South Korea
    [/Seoul|KAIST|POSTECH|Korea University|Yonsei|Hanyang|Sungkyunkwan|Ewha|Sogang|Samsung|Naver|Kakao/i, 'South Korea'],
    // India
    [/IIT\b|IISc|IIIT|Indian Institute|Indian Statistical|Jawaharlal|BITS Pilani|NIT\b|Tata\b|Infosys|Wipro|TCS\b|Rangasamy|VIT\b|SRM\b|Manipal|Amity|KIIT|Jadavpur|Anna University/i, 'India'],
    // Australia
    [/Sydney|Melbourne|Queensland|Monash|ANU\b|Australian National|UNSW|CSIRO|Adelaide|Western Australia|Macquarie|Griffith|Deakin|Curtin|Tasmania|Wollongong/i, 'Australia'],
    // Singapore
    [/National University of Singapore|NUS\b|NTU.*Singapore|Nanyang|SUTD|Singapore Management|A\*STAR/i, 'Singapore'],
    // Netherlands
    [/Amsterdam|Delft|Utrecht|Leiden|Eindhoven|Groningen|Twente|Erasmus|Tilburg|Radboud|Wageningen/i, 'Netherlands'],
    // Israel
    [/Technion|Hebrew University|Tel Aviv|Weizmann|Ben-?Gurion|Bar-?Ilan/i, 'Israel'],
    // Italy
    [/Sapienza|Politecnico|Bocconi|Trento/i, 'Italy'],
    // Spain
    [/Salamanca|Basque/i, 'Spain'],
    // Sweden
    [/KTH\b|Chalmers|Linköping/i, 'Sweden'],
    // Denmark
    [/DTU\b|Aalborg/i, 'Denmark'],
    // Finland
    [/Aalto/i, 'Finland'],
    // Brazil
    [/USP\b|UNICAMP|UFRJ|PUC.*Rio/i, 'Brazil'],
    // Qatar
    [/HBKU|Hamad Bin/i, 'Qatar'],
    // Saudi Arabia
    [/KAUST|King Abdullah|King Saud|King Fahd|KFUPM/i, 'Saudi Arabia'],
    // UAE
    [/MBZUAI|NYU Abu Dhabi|Khalifa|Mohamed bin Zayed/i, 'United Arab Emirates'],
];

// Tier 2: Country names (direct mention in institution string)
// Ordered by specificity — longer/compound names first to avoid partial matches
const COUNTRY_NAMES = [
    // Compound names first
    ['United States', 'United States'], ['United Kingdom', 'United Kingdom'],
    ['South Korea', 'South Korea'], ['North Korea', 'North Korea'],
    ['South Africa', 'South Africa'], ['New Zealand', 'New Zealand'],
    ['Saudi Arabia', 'Saudi Arabia'], ['Sri Lanka', 'Sri Lanka'],
    ['Costa Rica', 'Costa Rica'], ['Puerto Rico', 'United States'],
    ['Czech Republic', 'Czech Republic'], ['Dominican Republic', 'Dominican Republic'],
    ['Trinidad and Tobago', 'Trinidad and Tobago'],
    ['Papua New Guinea', 'Papua New Guinea'],
    ['Hong Kong', 'China'], ['Macau', 'China'], ['Macao', 'China'],
    ['Taiwan', 'China'],
    // Common abbreviations
    ['USA', 'United States'], ['U\\.S\\.A', 'United States'], ['U\\.S\\.', 'United States'],
    ['U\\.K\\.', 'United Kingdom'],
    ['UAE', 'United Arab Emirates'], ['U\\.A\\.E', 'United Arab Emirates'],
    ['P\\.R\\.\\s*China', 'China'], ['PR China', 'China'], ['PRC', 'China'],
    ['R\\.O\\.C', 'China'], ['ROC', 'China'],
    // Single-word country names
    ['Afghanistan', 'Afghanistan'], ['Albania', 'Albania'], ['Algeria', 'Algeria'],
    ['Argentina', 'Argentina'], ['Armenia', 'Armenia'], ['Australia', 'Australia'],
    ['Austria', 'Austria'], ['Azerbaijan', 'Azerbaijan'],
    ['Bahrain', 'Bahrain'], ['Bangladesh', 'Bangladesh'], ['Belarus', 'Belarus'],
    ['Belgium', 'Belgium'], ['Bolivia', 'Bolivia'], ['Bosnia', 'Bosnia and Herzegovina'],
    ['Botswana', 'Botswana'], ['Brazil', 'Brazil'], ['Brunei', 'Brunei'],
    ['Bulgaria', 'Bulgaria'], ['Cambodia', 'Cambodia'], ['Cameroon', 'Cameroon'],
    ['Canada', 'Canada'], ['Chile', 'Chile'], ['China', 'China'],
    ['Colombia', 'Colombia'], ['Croatia', 'Croatia'], ['Cuba', 'Cuba'],
    ['Cyprus', 'Cyprus'], ['Czechia', 'Czech Republic'],
    ['Denmark', 'Denmark'],
    ['Ecuador', 'Ecuador'], ['Egypt', 'Egypt'], ['Estonia', 'Estonia'],
    ['Ethiopia', 'Ethiopia'], ['Finland', 'Finland'], ['France', 'France'],
    ['Georgia', 'Georgia'], ['Germany', 'Germany'], ['Ghana', 'Ghana'],
    ['Greece', 'Greece'], ['Guatemala', 'Guatemala'],
    ['Hungary', 'Hungary'], ['Iceland', 'Iceland'], ['India', 'India'],
    ['Indonesia', 'Indonesia'], ['Iran', 'Iran'], ['Iraq', 'Iraq'],
    ['Ireland', 'Ireland'], ['Israel', 'Israel'], ['Italy', 'Italy'],
    ['Jamaica', 'Jamaica'], ['Japan', 'Japan'], ['Jordan', 'Jordan'],
    ['Kazakhstan', 'Kazakhstan'], ['Kenya', 'Kenya'], ['Kuwait', 'Kuwait'],
    ['Kyrgyzstan', 'Kyrgyzstan'],
    ['Latvia', 'Latvia'], ['Lebanon', 'Lebanon'], ['Libya', 'Libya'],
    ['Lithuania', 'Lithuania'], ['Luxembourg', 'Luxembourg'],
    ['Malaysia', 'Malaysia'], ['Mexico', 'Mexico'], ['Moldova', 'Moldova'],
    ['Mongolia', 'Mongolia'], ['Montenegro', 'Montenegro'], ['Morocco', 'Morocco'],
    ['Myanmar', 'Myanmar'], ['Nepal', 'Nepal'], ['Netherlands', 'Netherlands'],
    ['Nigeria', 'Nigeria'], ['Norway', 'Norway'],
    ['Oman', 'Oman'], ['Pakistan', 'Pakistan'], ['Palestine', 'Palestine'],
    ['Panama', 'Panama'], ['Paraguay', 'Paraguay'], ['Peru', 'Peru'],
    ['Philippines', 'Philippines'], ['Poland', 'Poland'], ['Portugal', 'Portugal'],
    ['Qatar', 'Qatar'], ['Romania', 'Romania'], ['Russia', 'Russia'],
    ['Rwanda', 'Rwanda'],
    ['Senegal', 'Senegal'], ['Serbia', 'Serbia'], ['Singapore', 'Singapore'],
    ['Slovakia', 'Slovakia'], ['Slovenia', 'Slovenia'], ['Somalia', 'Somalia'],
    ['Spain', 'Spain'], ['Sudan', 'Sudan'], ['Sweden', 'Sweden'],
    ['Switzerland', 'Switzerland'], ['Syria', 'Syria'],
    ['Thailand', 'Thailand'], ['Tunisia', 'Tunisia'], ['Turkey', 'Turkey'],
    ['Türkiye', 'Turkey'],
    ['Uganda', 'Uganda'], ['Ukraine', 'Ukraine'],
    ['Uruguay', 'Uruguay'], ['Uzbekistan', 'Uzbekistan'],
    ['Venezuela', 'Venezuela'], ['Vietnam', 'Vietnam'], ['Viet Nam', 'Vietnam'],
    ['Yemen', 'Yemen'], ['Zambia', 'Zambia'], ['Zimbabwe', 'Zimbabwe'],
    // Demonyms/adjectives sometimes used
    ['Korean', 'South Korea'], ['Japanese', 'Japan'], ['Chinese', 'China'],
    ['Brazilian', 'Brazil'], ['Mexican', 'Mexico'], ['Russian', 'Russia'],
    ['Turkish', 'Turkey'], ['Polish', 'Poland'], ['Swedish', 'Sweden'],
    ['Norwegian', 'Norway'], ['Danish', 'Denmark'], ['Finnish', 'Finland'],
    ['Scottish', 'United Kingdom'], ['Welsh', 'United Kingdom'],
];

// Tier 3: Major city names → country (only cities unlikely to be ambiguous)
const CITY_PATTERNS = [
    [/\bMilan\b|Rome\b|Turin\b|Bologna\b|Padua\b|Pisa\b|Florence\b/i, 'Italy'],
    [/\bBarcelona\b|Madrid\b|Valencia\b|Seville\b|Granada\b/i, 'Spain'],
    [/\bStockholm\b|Uppsala\b|Lund\b|Gothenburg\b/i, 'Sweden'],
    [/\bCopenhagen\b|Aarhus\b/i, 'Denmark'],
    [/\bHelsinki\b|Turku\b|Tampere\b|Oulu\b/i, 'Finland'],
    [/\bSão Paulo\b|Campinas\b|Rio de Janeiro\b/i, 'Brazil'],
    [/\bBangkok\b|Chiang Mai\b|Chulalongkorn/i, 'Thailand'],
    [/\bLagos\b|Ibadan\b|Abuja\b/i, 'Nigeria'],
    [/\bNairobi\b|Mombasa\b/i, 'Kenya'],
    [/\bCape Town\b|Johannesburg\b|Pretoria\b|Stellenbosch\b|Witwatersrand/i, 'South Africa'],
    [/\bDublin\b|Trinity College Dublin|University College Dublin/i, 'Ireland'],
    [/\bLisbon\b|Porto\b|Coimbra\b/i, 'Portugal'],
    [/\bVienna\b|Graz\b|Innsbruck\b/i, 'Austria'],
    [/\bWarsaw\b|Kraków\b|Krakow\b|Wroclaw\b|Gdansk\b|Poznan\b/i, 'Poland'],
    [/\bPrague\b|Brno\b/i, 'Czech Republic'],
    [/\bBudapest\b|Debrecen\b/i, 'Hungary'],
    [/\bBucharest\b|Cluj\b/i, 'Romania'],
    [/\bAthens\b|Thessaloniki\b/i, 'Greece'],
    [/\bBelgrade\b|Novi Sad\b/i, 'Serbia'],
    [/\bZagreb\b/i, 'Croatia'],
    [/\bLjubljana\b/i, 'Slovenia'],
    [/\bBratislava\b|Košice\b/i, 'Slovakia'],
    [/\bTallinn\b|Tartu\b/i, 'Estonia'],
    [/\bRiga\b/i, 'Latvia'],
    [/\bVilnius\b|Kaunas\b/i, 'Lithuania'],
    [/\bOslo\b|Bergen\b|Trondheim\b|NTNU\b/i, 'Norway'],
    [/\bKuala Lumpur\b|Malaya\b/i, 'Malaysia'],
    [/\bJakarta\b|Bandung\b|Gadjah Mada/i, 'Indonesia'],
    [/\bManila\b|Ateneo\b|De La Salle/i, 'Philippines'],
    [/\bHanoi\b|Ho Chi Minh/i, 'Vietnam'],
    [/\bDelhi\b|Mumbai\b|Bangalore\b|Bengaluru\b|Hyderabad\b|Chennai\b|Kolkata\b|Pune\b/i, 'India'],
    [/\bDoha\b/i, 'Qatar'],
    [/\bDubai\b|Abu Dhabi\b/i, 'United Arab Emirates'],
    [/\bRiyadh\b|Jeddah\b/i, 'Saudi Arabia'],
    [/\bTehran\b|Isfahan\b|Sharif\b/i, 'Iran'],
    [/\bAnkara\b|Istanbul\b|Izmir\b|Boğaziçi|Bilkent|Koç University/i, 'Turkey'],
    [/\bCairo\b|Alexandria\b/i, 'Egypt'],
    [/\bMoscow\b|Saint Petersburg\b|Novosibirsk\b|Skolkovo\b|Skoltech/i, 'Russia'],
    [/\bKyiv\b|Kiev\b|Kharkiv\b|Lviv\b/i, 'Ukraine'],
    [/\bSantiago\b.*Chile|Pontificia Universidad Católica de Chile/i, 'Chile'],
    [/\bBuenos Aires\b/i, 'Argentina'],
    [/\bBogotá\b|Bogota\b|Medellín\b|Medellin\b/i, 'Colombia'],
    [/\bLima\b.*Peru|Pontificia Universidad Católica del Perú/i, 'Peru'],
    [/\bMexico City\b|Ciudad de México\b|UNAM\b|Tecnológico de Monterrey|Monterrey\b/i, 'Mexico'],
];

/**
 * Infer country from an institution string using a three-tier approach:
 * 1. Known institution/company patterns (high precision)
 * 2. Country name directly in the string (high recall)
 * 3. Major city names (fallback)
 *
 * @param {string} institution - raw institution string from Scholar profile
 * @returns {string} country name or '' if unknown
 */
export function inferCountry(institution) {
    if (!institution) return '';
    const text = institution;

    // Tier 1: Specific institution patterns (most precise)
    for (const [pattern, country] of INSTITUTION_PATTERNS) {
        if (pattern.test(text)) return country;
    }

    // Tier 2: Country name mentioned in the string
    for (const [name, country] of COUNTRY_NAMES) {
        // Use word boundary to avoid partial matches (e.g. "Jordan" in "Jordan Smith")
        // But be lenient — country at end of string or after comma is a strong signal
        const re = new RegExp(`\\b${name}\\b`, 'i');
        if (re.test(text)) return country;
    }

    // Tier 3: Major city name fallback
    for (const [pattern, country] of CITY_PATTERNS) {
        if (pattern.test(text)) return country;
    }

    return '';
}

/**
 * Build geo data from scholarProfiles + publications (Selenium-scraped data).
 * This replaces the LLM-based geoData with verified data from Scholar profiles.
 *
 * @param {Array} publications - publications with citations[].authorList
 * @param {Object} scholarProfiles - { scholarId: { fullName, institution, totalCitations } }
 * @param {boolean} firstAuthorOnly - if true, only count first author per citation
 * @returns {Object} geoData in { "pubIdx_citIdx": { country, institution } } format
 */
export function buildGeoFromProfiles(publications, scholarProfiles, firstAuthorOnly = true) {
    const geoData = {};

    // Infer country using the module-level inferCountry function

    for (let pi = 0; pi < publications.length; pi++) {
        const pub = publications[pi];
        for (let ci = 0; ci < (pub.citations || []).length; ci++) {
            const cit = pub.citations[ci];
            const authorList = cit.authorList || [];

            if (firstAuthorOnly) {
                // First author mode: one geo entry per citation
                const authors = authorList.filter(a => a.isFirstAuthor).slice(0, 1);
                const effectiveAuthors = authors.length > 0 ? authors : (authorList.length > 0 ? [authorList[0]] : []);

                for (const author of effectiveAuthors) {
                    const sid = author.scholarId || '';
                    const profile = sid ? (scholarProfiles[sid] || {}) : {};
                    const institution = profile.institution || '';
                    const country = inferCountry(institution);

                    if (country || institution) {
                        const cleanedInst = cleanInstitution(institution) || institution;
                        geoData[`${pi}_${ci}`] = { country, institution: cleanedInst === '—' ? '' : cleanedInst };
                        break;
                    }
                }
            } else {
                // All authors mode: one geo entry per unique country per citation
                const seenCountries = new Set();
                let ai = 0;
                for (const author of authorList) {
                    const sid = author.scholarId || '';
                    const profile = sid ? (scholarProfiles[sid] || {}) : {};
                    const institution = profile.institution || '';
                    const country = inferCountry(institution);

                    if (country && !seenCountries.has(country)) {
                        seenCountries.add(country);
                        const cleanedInst = cleanInstitution(institution) || institution;
                        geoData[`${pi}_${ci}_${ai}`] = { country, institution: cleanedInst === '—' ? '' : cleanedInst };
                    }
                    ai++;
                }
                // If no author had a country, still try to get at least one entry
                if (seenCountries.size === 0) {
                    for (const author of authorList) {
                        const sid = author.scholarId || '';
                        const profile = sid ? (scholarProfiles[sid] || {}) : {};
                        const institution = profile.institution || '';
                        if (institution) {
                            const cleanedInst = cleanInstitution(institution) || institution;
                            geoData[`${pi}_${ci}`] = { country: '', institution: cleanedInst === '—' ? '' : cleanedInst };
                            break;
                        }
                    }
                }
            }
        }
    }

    return geoData;
}

/**
 * Aggregate geo data into country-level counts.
 */
export function aggregateGeoData(geoData) {
    const countryCounts = {};
    const countryInstitutions = {};
    const mappedCitations = new Set(); // track unique citations (pi_ci)

    for (const [key, info] of Object.entries(geoData)) {
        const country = info.country;
        if (!country) continue;
        countryCounts[country] = (countryCounts[country] || 0) + 1;
        if (info.institution) {
            if (!countryInstitutions[country]) countryInstitutions[country] = new Set();
            countryInstitutions[country].add(info.institution);
        }
        // Extract citation key (pi_ci) — handles both "pi_ci" and "pi_ci_ai" formats
        const parts = key.split('_');
        mappedCitations.add(`${parts[0]}_${parts[1]}`);
    }

    const points = [];

    for (const [country, count] of Object.entries(countryCounts)) {
        const institutions = countryInstitutions[country]
            ? Array.from(countryInstitutions[country])
            : [];

        points.push({
            country,
            count,
            institutions,
        });
    }

    points.sort((a, b) => b.count - a.count);

    return {
        points,
        countryCount: Object.keys(countryCounts).length,
        totalMapped: mappedCitations.size, // unique citations, not total entries
    };
}

/**
 * Load GeoJSON country boundaries (cached).
 */
async function loadGeoJson() {
    if (geoJsonData) return geoJsonData;
    const resp = await fetch('https://unpkg.com/world-atlas@2/countries-110m.json');
    const topoData = await resp.json();
    // Convert TopoJSON to GeoJSON using topojson-client
    // globe.gl can handle topojson directly via polygonsData, but we need
    // to use the hexed polygon layer. Let's use the geojson URL instead.
    geoJsonData = topoData;
    return geoJsonData;
}

/**
 * Match a citation country name to a GeoJSON feature.
 */
function matchCountryToFeature(countryName, features) {
    const lower = countryName.toLowerCase();

    // Direct match on feature properties.name or properties.NAME
    for (const f of features) {
        const fName = (f.properties.name || f.properties.NAME || '').toLowerCase();
        if (fName === lower) return f;
    }

    // Try alias map
    const canonical = aliasMap[lower];
    if (canonical) {
        for (const f of features) {
            const fName = (f.properties.name || f.properties.NAME || '').toLowerCase();
            if (fName === canonical.toLowerCase()) return f;
        }
    }

    // Partial match
    for (const f of features) {
        const fName = (f.properties.name || f.properties.NAME || '').toLowerCase();
        if (fName.includes(lower) || lower.includes(fName)) return f;
    }

    return null;
}

/**
 * Initialize and render the 3D globe with country highlighting.
 */
export async function initGlobe(container, points, stats) {
    destroyGlobe();

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Find max count for brightness normalization
    const maxCount = Math.max(...points.map(p => p.count), 1);

    // Build country → data lookup
    const countryDataMap = {};
    for (const p of points) {
        countryDataMap[p.country.toLowerCase()] = p;
        // Also index by aliases
        const canonical = aliasMap[p.country.toLowerCase()];
        if (canonical) countryDataMap[canonical.toLowerCase()] = p;
    }

    // Load GeoJSON for country polygons
    const geoUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

    globeInstance = Globe()
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
        .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
        .width(width)
        .height(height)
        .showAtmosphere(true)
        .atmosphereColor('#6366f1')
        .atmosphereAltitude(0.2)
        // Polygon layer for country highlighting
        .polygonsData([]) // will set after loading
        .polygonAltitude(d => {
            const data = getCountryData(d, countryDataMap);
            return data ? 0.01 + (data.count / maxCount) * 0.03 : 0;
        })
        .polygonCapColor(d => {
            const data = getCountryData(d, countryDataMap);
            if (!data) return 'rgba(0, 0, 0, 0)'; // transparent for non-cited countries
            // Brightness based on citation count
            const intensity = 0.25 + 0.75 * Math.min(data.count / maxCount, 1);
            return interpolateGlowColor(intensity);
        })
        .polygonSideColor(d => {
            const data = getCountryData(d, countryDataMap);
            if (!data) return 'rgba(0, 0, 0, 0)';
            const intensity = 0.2 + 0.8 * Math.min(data.count / maxCount, 1);
            return `rgba(99, 102, 241, ${intensity * 0.4})`;
        })
        .polygonStrokeColor(d => {
            const data = getCountryData(d, countryDataMap);
            if (!data) return 'rgba(50, 50, 80, 0.1)';
            return 'rgba(168, 85, 247, 0.6)';
        })
        .polygonLabel(d => {
            const name = d.properties.name || d.properties.NAME || 'Unknown';
            const data = getCountryData(d, countryDataMap);
            if (!data) return '';
            const instList = data.institutions.slice(0, 5).join(', ');
            return `
                <div style="background:rgba(10,10,20,0.92);padding:12px 16px;border-radius:10px;border:1px solid rgba(100,100,200,0.25);backdrop-filter:blur(12px);max-width:320px;">
                    <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:4px;">${name}</div>
                    <div style="font-size:13px;color:#a855f7;margin-bottom:6px;font-weight:600;">${data.count} citation${data.count > 1 ? 's' : ''}</div>
                    ${instList ? `<div style="font-size:11px;color:#8888aa;border-top:1px solid rgba(100,100,200,0.15);padding-top:6px;line-height:1.5;">${instList}${data.institutions.length > 5 ? `<br>+${data.institutions.length - 5} more` : ''}</div>` : ''}
                </div>
            `;
        })
        .onPolygonHover(hoverD => {
            if (globeInstance) {
                const el = globeInstance.domElement?.parentElement;
                const hasCitations = hoverD && getCountryData(hoverD, countryDataMap);
                if (el) el.style.cursor = hasCitations ? 'pointer' : 'default';
                // Pause rotation when hovering a cited country
                globeInstance.controls().autoRotate = !hasCitations;
            }
        })
        (container);

    // Load TopoJSON and convert to polygon features
    try {
        const resp = await fetch(geoUrl);
        const topology = await resp.json();
        // topojson → geojson conversion (inline, no dependency)
        const countries = topoFeatures(topology, 'countries');
        globeInstance.polygonsData(countries);
    } catch (e) {
        console.warn('Failed to load country boundaries:', e);
    }

    // Auto-rotate
    globeInstance.controls().autoRotate = true;
    globeInstance.controls().autoRotateSpeed = 0.8;
    globeInstance.controls().enableDamping = true;
    globeInstance.controls().dampingFactor = 0.1;
    // Disable scroll zoom so page scrolls naturally to rankings below
    globeInstance.controls().enableZoom = false;

    // Prevent Three.js OrbitControls from capturing wheel events
    // so the parent wrapper can scroll to the rankings section
    const renderer = container.querySelector('canvas');
    if (renderer) {
        renderer.addEventListener('wheel', (e) => {
            e.stopImmediatePropagation();
            // Let it bubble to the wrapper for native scroll
            container.parentElement.scrollTop += e.deltaY;
        }, true);
    }

    // Initial camera position
    globeInstance.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });

    // Stats overlay
    updateGlobeStats(container, stats);

    // Resize handler
    const resizeHandler = () => {
        if (!globeInstance) return;
        globeInstance.width(container.clientWidth).height(container.clientHeight);
    };
    window.addEventListener('resize', resizeHandler);
    container._resizeHandler = resizeHandler;
}

/**
 * Get citation data for a GeoJSON feature.
 */
function getCountryData(feature, countryDataMap) {
    const name = (feature.properties.name || feature.properties.NAME || '').toLowerCase();
    if (countryDataMap[name]) return countryDataMap[name];
    // Try alias
    const canonical = aliasMap[name];
    if (canonical && countryDataMap[canonical.toLowerCase()]) {
        return countryDataMap[canonical.toLowerCase()];
    }
    // Try partial
    for (const [key, val] of Object.entries(countryDataMap)) {
        if (name.includes(key) || key.includes(name)) return val;
    }
    return null;
}

/**
 * Interpolate glow color from dim purple to bright cyan-white based on intensity [0,1].
 */
function interpolateGlowColor(t) {
    // Low: dim indigo → Medium: purple → High: bright cyan-white
    if (t < 0.33) {
        const r = Math.round(60 + t * 3 * 40);
        const g = Math.round(50 + t * 3 * 50);
        const b = Math.round(140 + t * 3 * 60);
        return `rgba(${r}, ${g}, ${b}, ${0.4 + t * 0.3})`;
    } else if (t < 0.66) {
        const s = (t - 0.33) / 0.33;
        const r = Math.round(100 + s * 68);
        const g = Math.round(100 + s * 55);
        const b = Math.round(200 + s * 47);
        return `rgba(${r}, ${g}, ${b}, ${0.55 + s * 0.2})`;
    } else {
        const s = (t - 0.66) / 0.34;
        const r = Math.round(168 + s * 87);
        const g = Math.round(155 + s * 100);
        const b = Math.round(247);
        return `rgba(${r}, ${g}, ${b}, ${0.75 + s * 0.25})`;
    }
}

/**
 * Minimal TopoJSON → GeoJSON converter (no dependency needed).
 */
function topoFeatures(topology, objectName) {
    const obj = topology.objects[objectName];
    if (!obj) {
        // Try first available object
        const key = Object.keys(topology.objects)[0];
        if (!key) return [];
        return topoFeatures(topology, key);
    }

    const arcs = topology.arcs;
    const transform = topology.transform;

    function decodeArc(arcIdx) {
        const reversed = arcIdx < 0;
        const idx = reversed ? ~arcIdx : arcIdx;
        const arc = arcs[idx];
        const coords = [];
        let x = 0, y = 0;

        for (const [dx, dy] of arc) {
            x += dx;
            y += dy;
            const lng = transform ? x * transform.scale[0] + transform.translate[0] : x;
            const lat = transform ? y * transform.scale[1] + transform.translate[1] : y;
            coords.push([lng, lat]);
        }

        return reversed ? coords.reverse() : coords;
    }

    function decodeRing(ring) {
        const coords = [];
        for (const arcIdx of ring) {
            const arcCoords = decodeArc(arcIdx);
            // Skip first point of subsequent arcs to avoid duplicates
            coords.push(...(coords.length > 0 ? arcCoords.slice(1) : arcCoords));
        }
        return coords;
    }

    function decodeGeometry(geom) {
        if (geom.type === 'Polygon') {
            return {
                type: 'Polygon',
                coordinates: geom.arcs.map(decodeRing),
            };
        } else if (geom.type === 'MultiPolygon') {
            return {
                type: 'MultiPolygon',
                coordinates: geom.arcs.map(polygon => polygon.map(decodeRing)),
            };
        }
        return geom;
    }

    if (obj.type === 'GeometryCollection') {
        return obj.geometries.map(geom => ({
            type: 'Feature',
            properties: geom.properties || {},
            geometry: decodeGeometry(geom),
        }));
    }

    return [{
        type: 'Feature',
        properties: obj.properties || {},
        geometry: decodeGeometry(obj),
    }];
}

function updateGlobeStats(container, stats) {
    let overlay = container.querySelector('.globe-stats');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'globe-stats';
        container.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="globe-stat-item">
            <span class="globe-stat-number">${stats.totalMapped}</span>
            <span class="globe-stat-label">Mapped Citations</span>
        </div>
        <div class="globe-stat-item">
            <span class="globe-stat-number">${stats.countryCount}</span>
            <span class="globe-stat-label">Countries</span>
        </div>
    `;
}

export function updateGlobeData(points, stats) {
    if (!globeInstance) return;
    // Would need to re-init to update polygon colors properly
    const container = globeInstance.domElement?.parentElement;
    if (container) {
        initGlobe(container, points, stats);
    }
}

export function destroyGlobe() {
    if (globeInstance) {
        const container = globeInstance.domElement?.parentElement;
        if (container?._resizeHandler) {
            window.removeEventListener('resize', container._resizeHandler);
        }

        // Properly dispose Three.js renderer to free WebGL context
        try {
            const renderer = globeInstance.renderer?.();
            if (renderer) {
                renderer.dispose();
                renderer.forceContextLoss();
                const canvas = renderer.domElement;
                if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
            }
            globeInstance.controls?.().dispose?.();
            globeInstance._destructor?.();
        } catch (e) { /* ignore cleanup errors */ }

        // Clear globe container DOM (except stats overlay and empty state)
        if (container) {
            const children = Array.from(container.children);
            for (const child of children) {
                if (!child.classList.contains('globe-stats') && !child.classList.contains('globe-empty')) {
                    child.remove();
                }
            }
        }

        globeInstance = null;
    }
}
