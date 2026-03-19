// ── D3.js Force-Directed Graph ──

let svg, g, simulation;
let currentNetwork = null;
let width, height;

const NODE_SIZES = {
    researcher: 24,
    publication: 8,   // base, scales with citations
    citation: 4,
};

export function initGraph(container) {
    width = container.clientWidth;
    height = container.clientHeight;

    svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    // Defs for gradients and glow
    const defs = svg.append('defs');

    const glowFilter = defs.append('filter').attr('id', 'glow');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
    svg.call(zoom);

    // Handle window resize
    window.addEventListener('resize', () => {
        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('width', width).attr('height', height);
        if (simulation) {
            simulation.force('center', d3.forceCenter(width / 2, height / 2));
            simulation.alpha(0.3).restart();
        }
    });
}

/**
 * Render or update the network graph.
 * @param {Object} network - { nodes, links, themes }
 * @param {Object} callbacks - { onTooltip, onHideTooltip, onToggleCitations }
 */
export function renderGraph(network, callbacks = {}) {
    currentNetwork = network;

    // Clear previous
    g.selectAll('*').remove();

    const visibleNodes = network.nodes.filter(n => !n.hidden);
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleLinks = network.links.filter(l => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        return visibleNodeIds.has(src) && visibleNodeIds.has(tgt);
    });

    // Force simulation
    simulation = d3.forceSimulation(visibleNodes)
        .force('link', d3.forceLink(visibleLinks).id(d => d.id).distance(d => {
            if (d.type === 'researcher-pub') return 120;
            return 60;
        }))
        .force('charge', d3.forceManyBody().strength(d => {
            if (d.type === 'researcher') return -400;
            if (d.type === 'publication') return -100;
            return -30;
        }))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => getNodeRadius(d) + 4));

    // Links
    const link = g.append('g')
        .selectAll('line')
        .data(visibleLinks)
        .join('line')
        .attr('class', d => `link link-${d.type}`)
        .attr('stroke', d => d.type === 'researcher-pub' ? '#6366f1' : '#a855f7')
        .attr('stroke-width', d => d.type === 'researcher-pub' ? 1.5 : 0.8);

    // Node groups
    const node = g.append('g')
        .selectAll('g')
        .data(visibleNodes)
        .join('g')
        .attr('class', d => `node-${d.type}`)
        .call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded));

    // Node circles
    node.append('circle')
        .attr('r', d => getNodeRadius(d))
        .attr('fill', d => getNodeColor(d))
        .attr('stroke', d => d.type === 'researcher' ? '#fff' : 'none')
        .attr('stroke-width', d => d.type === 'researcher' ? 2 : 0)
        .style('filter', d => d.type === 'researcher' ? 'url(#glow)' : 'none');

    // Labels for researcher and large publications
    node.filter(d => d.type === 'researcher')
        .append('text')
        .attr('class', 'node-label node-label-researcher')
        .attr('dy', d => getNodeRadius(d) + 18)
        .text(d => d.label);

    // Hover events
    node.on('mouseover', (event, d) => {
        // Highlight connected links
        link.classed('link-highlight', l => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return src === d.id || tgt === d.id;
        });

        if (callbacks.onTooltip) {
            callbacks.onTooltip(event, d);
        }
    })
    .on('mousemove', (event, d) => {
        if (callbacks.onTooltip) callbacks.onTooltip(event, d);
    })
    .on('mouseout', (event, d) => {
        link.classed('link-highlight', false);
        if (callbacks.onHideTooltip) callbacks.onHideTooltip();
    });

    // Click to expand/collapse citations
    node.filter(d => d.type === 'publication')
        .on('click', (event, d) => {
            event.stopPropagation();
            if (callbacks.onToggleCitations) {
                callbacks.onToggleCitations(d);
            }
        });

    // Tick
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Render legend
    renderLegend(network.themes);
}

function getNodeRadius(d) {
    if (d.type === 'researcher') return NODE_SIZES.researcher;
    if (d.type === 'publication') {
        return Math.max(NODE_SIZES.publication, Math.min(20, 5 + Math.sqrt(d.citationCount || 0) * 1.5));
    }
    return NODE_SIZES.citation;
}

function getNodeColor(d) {
    if (d.type === 'researcher') return '#6366f1';
    if (d.type === 'publication') return d.themeColor || '#6366f1';
    if (d.type === 'citation') return (d.parentThemeColor || '#6366f1') + 'aa'; // parent color, slightly transparent
    return '#4a4a6a';
}

function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function renderLegend(themes) {
    const legend = document.getElementById('legend');
    if (!themes || themes.length === 0) {
        legend.style.display = 'none';
        return;
    }

    legend.style.display = 'block';
    legend.innerHTML = `
        <h4>Research Themes</h4>
        ${themes.map(t => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${t.color}"></span>
                <span>${t.name}</span>
            </div>
        `).join('')}
        <div class="legend-item" style="margin-top:8px;border-top:1px solid rgba(100,100,180,0.15);padding-top:6px;">
            <span class="legend-dot" style="background:#4a4a6a"></span>
            <span style="color:#8888aa">Citations (click pub to show)</span>
        </div>
    `;
}

export function destroyGraph() {
    if (simulation) simulation.stop();
    if (svg) svg.remove();
    svg = null;
    g = null;
    simulation = null;
}
