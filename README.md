# Research Network Visualizer

Visualize the impact of your academic research — see your publications, citations, and global reach on an interactive network graph, 3D globe, and scholar rankings.

---

## Quick Start

### 1. Fork & Clone

```bash
# Fork this repo on GitHub (click "Fork" button), then clone your fork
git clone https://github.com/YOUR_USERNAME/Research_Network.git
cd Research_Network
```

### 2. Set Up `.env`

```bash
cp .env.example .env
```

Edit `.env` with your info:

```env
# Required
SCHOLAR_ID=YOUR_SCHOLAR_ID

# Optional — for publication classification
LLM_PROVIDER=openai
LLM_API_KEY=sk-xxx
LLM_MODEL=
```

Your Scholar ID is in your Google Scholar profile URL:
`scholar.google.com/citations?user=`**YOUR_ID**

> `.env` is gitignored — your keys never leave your machine.

### 3. Install & Run the Scraper

```bash
pip install -r scraper/requirements.txt

# Run (reads SCHOLAR_ID from .env)
python scraper/scholar_scraper.py

# Or pass Scholar ID directly
python scraper/scholar_scraper.py YOUR_SCHOLAR_ID
```

This will:
1. Open Chrome and scrape your Google Scholar profile
2. Collect all publications and their citing papers
3. Fetch author profiles (full names, institutions, citations)
4. Infer countries from institutions (no LLM needed)
5. Save everything to `data/network.json`

**Options:**

```bash
# Headless mode (no browser window)
python scraper/scholar_scraper.py --headless

# With LLM classification (themes + summaries, requires LLM_API_KEY in .env)
python scraper/scholar_scraper.py --classify
```

### 4. Enable GitHub Pages

1. Go to your repo on GitHub → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. The included `.github/workflows/deploy.yml` auto-deploys on every push

### 5. Push & Deploy

```bash
git add data/network.json
git commit -m "Update research data"
git push
```

Your site goes live at: `https://YOUR_USERNAME.github.io/Research_Network/`

Anyone who opens the link sees your results — no keys or setup needed.

---

## Updating Your Data

The scraper supports **incremental updates** — it compares with existing data and only fetches what's new:

```bash
# Just re-run the scraper
python scraper/scholar_scraper.py

# Then push
git add data/network.json && git commit -m "Update research data" && git push
```

It will:
- Detect new publications automatically
- Fetch citations only for publications with new citing papers
- Reuse cached data for unchanged publications
- Fetch profiles only for new Scholar IDs

---

## Three Views

Toggle between views using the **Network / Globe / Scholar** buttons.

### Network View
Interactive force-directed graph of your research network.

- **Center node** = You
- **Level 1** = Your publications (sized by citation count, colored by research theme)
- **Level 2** = Papers that cite yours
- Click a publication to expand/collapse its citations
- Hover for details (title, year, citations, summary)
- Filter by year range, top K, keyword search

### Globe View
3D rotating globe showing where your citations come from.

- Countries **light up** — brighter = more citations
- **Hover** a country to see citation count and top institutions
- Scroll down for **ranked leaderboards** (top countries + top institutions)
- Toggle **First Author / All Authors** mode

### Scholar View
Ranking tables for collaborators and citing authors.

- **Collaborators** — co-authors ranked by papers together
- **Citing Authors** — who cites your work, with institution, country, total citations
- **Hover** any row to see which publications they collaborated on / cited
- **Click** a name to visit their Google Scholar profile (if available)
- Toggle **First Author / All Authors** mode

---

## Configuration (`.env`)

| Variable | Description | Required? |
|----------|------------|-----------|
| `SCHOLAR_ID` | Your Google Scholar user ID | Yes |
| `LLM_PROVIDER` | `openai`, `claude`, or `gemini` | Only for `--classify` |
| `LLM_API_KEY` | Your LLM API key | Only for `--classify` |
| `LLM_MODEL` | Model override (default: auto per provider) | No |

The `--classify` flag uses an LLM to:
- **Classify** publications into research themes (Healthcare, NLP, CV, etc.)
- **Summarize** each paper in one sentence

Everything else (scraping, geo inference, author profiles) works without an LLM.

---

## Running Locally

```bash
# Serve the web app locally
python3 -m http.server 8080
# Open http://localhost:8080
```

---

## File Structure

```
Research_Network/
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions → GitHub Pages
├── .env.example            # Template for local config
├── .env                    # Your local config (gitignored)
├── index.html              # Main page (read-only viewer)
├── css/
│   └── style.css           # Dark theme styles
├── js/
│   ├── app.js              # Main entry, loads data + renders views
│   ├── scholar.js          # Citation/co-author parsing & aggregation
│   ├── network.js          # Builds node-link data structure
│   ├── graph.js            # D3.js force-directed graph
│   ├── globe.js            # 3D globe + country inference engine
│   ├── scholar-view.js     # Scholar rankings + tooltips
│   └── countries.js        # Country → coordinates mapping
├── scraper/
│   ├── scholar_scraper.py  # Selenium scraper (run locally)
│   └── requirements.txt    # Python dependencies
├── data/
│   └── network.json        # Generated data (auto-loaded by web app)
└── README.md
```

## Tech Stack

- Pure HTML/CSS/JS — no build step, no framework
- [D3.js v7](https://d3js.org/) — force-directed graph
- [globe.gl](https://globe.gl/) — 3D globe visualization
- [Selenium](https://www.selenium.dev/) — Google Scholar scraping
- OpenAI / Claude / Gemini — optional publication classification
