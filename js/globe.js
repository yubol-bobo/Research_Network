// ── 3D Globe Visualization using globe.gl ──
// Countries light up based on citation count (brighter = more citations)

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

/**
 * Aggregate geo data into country-level counts.
 */
export function aggregateGeoData(geoData) {
    const countryCounts = {};
    const countryInstitutions = {};

    for (const [, info] of Object.entries(geoData)) {
        const country = info.country;
        if (!country) continue;
        countryCounts[country] = (countryCounts[country] || 0) + 1;
        if (info.institution) {
            if (!countryInstitutions[country]) countryInstitutions[country] = new Set();
            countryInstitutions[country].add(info.institution);
        }
    }

    const points = [];
    let totalMapped = 0;

    for (const [country, count] of Object.entries(countryCounts)) {
        totalMapped += count;
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
        totalMapped,
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
