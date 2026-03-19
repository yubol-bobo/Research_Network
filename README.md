# Research Network Visualizer

Visualize the impact of your academic research — see your publications, citations, and global reach on an interactive network graph and 3D globe.

---

## Quick Start

### 1. Get Your API Keys

| Key | Where to Get It | Required? |
|-----|----------------|-----------|
| **ScraperAPI** | [scraperapi.com](https://www.scraperapi.com/) (free tier: 5,000 requests) | Yes |
| **Google Scholar ID** | Your profile URL: `scholar.google.com/citations?user=`**YOUR_ID** | Yes |
| **LLM API Key** | [OpenAI](https://platform.openai.com/), [Anthropic](https://console.anthropic.com/), or [Google AI](https://aistudio.google.com/) | Optional |

### 2. Open the App

No install needed — just serve the files:

```bash
# Option A: Python
python3 -m http.server 8080

# Option B: Node.js
npx serve

# Option C: Just open index.html in your browser
```

### 3. Configure Settings

Click the **gear icon** (top-right) and enter:
- Your **Google Scholar ID**
- Your **name** (displayed as the center node)
- Your **ScraperAPI key**
- (Optional) Pick an **LLM provider**, enter the API key and model name

Click **Save Settings**.

### 4. Click Refresh

The app will:
1. Fetch your publications from Google Scholar
2. Fetch citing papers for each publication
3. (If LLM configured) Cluster papers into research themes and generate summaries
4. (If LLM configured) Extract citation geolocation data (countries + institutions)
5. Render everything

---

## Two Views

### Network View
An interactive force-directed graph showing your research network.

- **Center node** = You
- **Level 1 nodes** = Your publications (sized by citation count, colored by theme)
- **Level 2 nodes** = Papers that cite yours

**Interactions:**
- **Hover** a node → see title, year, citations, summary
- **Click** a publication → expand/collapse its citing papers
- **Drag** nodes to rearrange
- **Zoom/pan** with scroll wheel + drag

**Filters** (top bar):
- Year range (from–to)
- Recent N publications
- Keyword search

### Globe View
A 3D rotating globe showing where your citations come from.

- Countries with citations **light up** (brighter = more citations)
- **Hover** a country → see citation count and top institutions
- Globe **pauses rotation** when hovering a country
- **Stats overlay** shows total mapped citations and country count

**Below the globe:** ranked leaderboards of top countries and institutions (adjustable top-K).

---

## Saving & Reusing Data

Scraping takes time (and API credits). Use **Export/Import** to avoid re-scraping:

1. After first Refresh, click **Export** → saves a `.json` file
2. Next time, click **Import** → load that file
3. Click **Refresh** again → only fetches *new* publications not already in the cache

The exported JSON includes publications, citations, and geolocation data.

---

## File Structure

```
Research_Network/
├── index.html          # Main page
├── css/style.css       # Dark theme styles
├── js/
│   ├── app.js          # Main entry point
│   ├── config.js       # Settings modal + localStorage
│   ├── scholar.js      # Google Scholar scraping via ScraperAPI
│   ├── llm.js          # LLM calls (OpenAI / Claude / Gemini)
│   ├── network.js      # Build node-link data structure
│   ├── graph.js        # D3.js force-directed graph
│   ├── globe.js        # 3D globe (globe.gl)
│   ├── countries.js    # Country → lat/lng mapping
│   └── cache.js        # JSON export/import + merge
└── README.md
```

## Tech Stack

- Pure HTML/CSS/JS — no build step, no framework
- [D3.js v7](https://d3js.org/) — force-directed graph
- [globe.gl](https://globe.gl/) — 3D globe visualization
- [ScraperAPI](https://www.scraperapi.com/) — Google Scholar access
- OpenAI / Claude / Gemini — paper analysis + geolocation inference
