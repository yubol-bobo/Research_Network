# Research Network Visualizer

Visualize the impact of your academic research — see your publications, citations, and global reach on an interactive network graph, 3D globe, and scholar rankings.

---

## Quick Start

### Step 1: Fork or Clone

```bash
# Option A: Fork this repo on GitHub (click "Fork" button), then clone your fork
git clone https://github.com/YOUR_USERNAME/Research_Network.git

# Option B: Clone directly
git clone https://github.com/yubol-bobo/Research_Network.git
cd Research_Network
```

### Step 2: Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** > **Pages** (left sidebar)
3. Under **Source**, select **GitHub Actions**
4. The included workflow (`.github/workflows/deploy.yml`) auto-deploys on every push

### Step 3: Scrape Your Data

Two methods are available:

#### Method A: Selenium (Recommended — Free)

Uses a local Python + Selenium scraper to control Chrome. No API keys needed for scraping.

```bash
# Install dependencies
pip install -r scraper/requirements.txt

# Run the scraper (opens Chrome, scrapes your Scholar profile)
python scraper/scholar_scraper.py YOUR_SCHOLAR_ID

# With full author names (slower, fetches each citing paper's page)
python scraper/scholar_scraper.py YOUR_SCHOLAR_ID

# Skip full author fetch (faster)
python scraper/scholar_scraper.py YOUR_SCHOLAR_ID --no-full-authors

# Headless mode (no browser window)
python scraper/scholar_scraper.py YOUR_SCHOLAR_ID --headless
```

This saves the result to `data/network.json` automatically. The scraper caches previous results — re-running only fetches new citations.

**Using the web UI Refresh button with Selenium:**

```bash
# Start the local scraper server
python scraper/server.py

# Then open the web app and click Refresh
# The app calls the local server which runs Selenium
```

#### Method B: ScraperAPI (Cloud — Needs Key)

Uses [ScraperAPI](https://www.scraperapi.com/) as a cloud proxy. Free tier gives 5,000 requests.

1. Open the deployed site
2. Click the **gear icon** > select **ScraperAPI** as scraping method
3. Enter your ScraperAPI key
4. Click **Refresh**

### Step 4: Push and Deploy

```bash
git add data/network.json
git commit -m "Add research network data"
git push origin main
```

Your site goes live at: `https://YOUR_USERNAME.github.io/Research_Network/`

Anyone who opens the link sees your results — no keys or setup needed.

---

## Configuration

| Setting | Where to Get It | Required? | Cost |
|---------|----------------|-----------|------|
| **Google Scholar ID** | Your profile URL: `scholar.google.com/citations?user=`**YOUR_ID** | Yes | Free |
| **Selenium** (Python) | `pip install selenium webdriver-manager` | For Method A | Free |
| **ScraperAPI Key** | [scraperapi.com](https://www.scraperapi.com/) | For Method B | Free tier: 5,000 requests |
| **LLM API Key** | [OpenAI](https://platform.openai.com/), [Anthropic](https://console.anthropic.com/), or [Google AI](https://aistudio.google.com/) | Optional | Pay-per-use |

> **Are my API keys safe?** Yes. All keys entered in the web UI are stored in your browser's `localStorage` — they never touch the repo, the server, or GitHub.

---

## Three Views

Toggle between views using the **Network / Globe / Scholar** buttons in the header.

### Network View
Interactive force-directed graph of your research network.

- **Center node** = You
- **Level 1** = Your publications (sized by citation count, colored by research theme)
- **Level 2** = Papers that cite yours

| Action | What it does |
|--------|-------------|
| Hover a node | See title, year, citations, summary |
| Click a publication | Expand/collapse its citing papers |
| Drag a node | Rearrange the layout |
| Scroll wheel | Zoom in/out |

**Filters**: year range, recent/most-cited top K, keyword search, show/hide citations.

### Globe View
3D rotating globe showing where your citations come from.

- Countries with citations **light up** — brighter = more citations
- **Hover** a country → see citation count and top institutions
- Globe **pauses** when you hover a cited country
- **Scroll down** for ranked leaderboards (top countries + top institutions)

### Scholar View
Ranking tables for collaborators and citing authors.

- **Collaborators** — your co-authors extracted from publication metadata
- **Citing Authors** — researchers who cite your work, with institution, country, and total citation count
- Toggle between **First Author** and **All Authors** mode
- Click **Fetch Citations** to look up each author's total citation count via their Scholar profile

---

## Saving & Sharing Results

### Export/Import
- After scraping → click **Export** → saves a `.json` snapshot
- Click **Import** → reload a previous snapshot
- Re-scraping only fetches new data not in the cache

### Share with Others (No Keys Needed)
1. Run the scraper or click Refresh
2. Export the JSON (or it's already at `data/network.json`)
3. Commit and push:
   ```bash
   git add data/network.json
   git commit -m "Update research network data"
   git push
   ```
4. Share your GitHub Pages URL — visitors see everything instantly

---

## LLM Features (Optional)

If you configure an LLM API key (OpenAI, Claude, or Gemini), the app adds:

- **Research theme clustering** — groups publications into broad themes (Healthcare, NLP, CV, RL, etc.)
- **Paper summaries** — one-line descriptions for each publication
- **Citation geolocation** — extracts country + institution from citing paper metadata

These are optional. The network graph, globe, and scholar views all work without an LLM key.

---

## Running Locally

```bash
# Serve the web app
cd Research_Network
python3 -m http.server 8080
# Open http://localhost:8080

# (Optional) Run the scraper server for web-based Refresh
python scraper/server.py
```

---

## File Structure

```
Research_Network/
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions → GitHub Pages
├── index.html              # Main page
├── css/
│   └── style.css           # Dark theme styles
├── js/
│   ├── app.js              # Main entry, wires everything together
│   ├── config.js           # Settings modal + localStorage
│   ├── scholar.js          # Google Scholar scraping via ScraperAPI
│   ├── llm.js              # LLM calls (OpenAI / Claude / Gemini)
│   ├── network.js          # Builds node-link data structure
│   ├── graph.js            # D3.js force-directed graph
│   ├── globe.js            # 3D globe with country highlighting
│   ├── scholar-view.js     # Scholar rankings view
│   ├── countries.js        # Country → coordinates mapping
│   └── cache.js            # JSON export/import + merge
├── scraper/
│   ├── scholar_scraper.py  # Selenium scraper (run locally)
│   ├── server.py           # Local server for web-based Refresh
│   └── requirements.txt    # Python dependencies
├── data/
│   └── network.json        # Pre-generated snapshot (auto-loaded)
└── README.md
```

## Tech Stack

- Pure HTML/CSS/JS — no build step, no framework
- [D3.js v7](https://d3js.org/) — force-directed graph
- [globe.gl](https://globe.gl/) — 3D globe visualization
- [Selenium](https://www.selenium.dev/) — local Google Scholar scraping
- [ScraperAPI](https://www.scraperapi.com/) — cloud-based Scholar access (alternative)
- OpenAI / Claude / Gemini — paper analysis + geolocation inference
