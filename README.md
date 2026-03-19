# Research Network Visualizer

Visualize the impact of your academic research — see your publications, citations, and global reach on an interactive network graph and 3D globe.

---

## Use This Template

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
4. That's it — the included workflow (`.github/workflows/deploy.yml`) will auto-deploy on every push

### Step 3: Push and Deploy

```bash
git push origin main
```

Go to the **Actions** tab in your repo — you'll see the "Deploy to GitHub Pages" workflow running. Once it finishes (usually ~30 seconds), your site is live at:

```
https://YOUR_USERNAME.github.io/Research_Network/
```

### Step 4: Configure on the Live Site

1. Open your deployed site
2. Click the **gear icon** (top-right) to open Settings
3. Enter your API keys (see table below)
4. Click **Save Settings** — keys are stored in your browser only, never in the repo
5. Click **Refresh** to fetch your data

---

## API Keys

| Key | Where to Get It | Required? | Cost |
|-----|----------------|-----------|------|
| **ScraperAPI** | [scraperapi.com](https://www.scraperapi.com/) | Yes | Free tier: 5,000 requests |
| **Google Scholar ID** | Your profile URL: `scholar.google.com/citations?user=`**YOUR_ID** | Yes | Free |
| **LLM API Key** | [OpenAI](https://platform.openai.com/), [Anthropic](https://console.anthropic.com/), or [Google AI](https://aistudio.google.com/) | Optional | Pay-per-use |

> **Are my keys safe?** Yes. All keys are stored in your browser's `localStorage` — they never touch the repo, the server, or GitHub. They stay on your machine.

---

## How It Works

1. Click **Refresh** on the live site
2. The app fetches your Google Scholar publications via ScraperAPI
3. For each publication, it fetches the citing papers
4. (If LLM key set) Papers are clustered into broad research themes + summarized
5. (If LLM key set) Citation geolocation is extracted (countries + institutions)
6. Everything renders in the two views below

---

## Two Views

Toggle between views using the **Network / Globe** buttons in the header.

### Network View
Interactive force-directed graph of your research network.

- **Center node** = You
- **Level 1** = Your publications (sized by citation count, colored by theme)
- **Level 2** = Papers that cite yours (click a publication to expand/collapse)

| Action | What it does |
|--------|-------------|
| Hover a node | See title, year, citations, summary |
| Click a publication | Expand/collapse its citing papers |
| Drag a node | Rearrange the layout |
| Scroll wheel | Zoom in/out |

**Filters** (top bar): year range, recent N publications, keyword search.

### Globe View
3D rotating globe showing where your citations come from.

- Countries with citations **light up** — brighter = more citations
- **Hover** a country → see citation count and top institutions
- Globe **pauses** when you hover a cited country
- **Scroll down** for ranked leaderboards (top countries + top institutions, adjustable K)

---

## Saving & Reusing Data

Scraping uses API credits and takes time. Use **Export/Import** to cache your data:

1. After first Refresh → click **Export** → saves a `.json` file to your computer
2. Next time → click **Import** → load that file
3. Click **Refresh** → only fetches *new* publications not in the cache

The exported JSON includes publications, citations, themes, summaries, and geolocation data.

---

## Sharing Your Results (No Keys Needed for Viewers)

Want to share your generated network with others? Just commit the exported JSON to the repo — visitors will see your results instantly, no API keys or setup required.

### How to share:

1. **Generate your data** — configure keys, click Refresh, wait for it to finish
2. **Export** — click the Export button, which downloads a file like `hgN6B6kAAAAJ_network.json`
3. **Move the file** into the `data/` folder (no rename needed):
   ```bash
   mv ~/Downloads/*_network.json data/
   ```
4. **Commit and push**:
   ```bash
   git add data/
   git commit -m "Add pre-generated network snapshot"
   git push
   ```
5. **Share the link** — anyone who opens your GitHub Pages URL will see the full network graph and globe automatically. No keys, no refresh, no setup.

> The app auto-detects snapshot files in `data/`. It looks for `data/{scholarId}_network.json` first (matching the exported filename), then falls back to `data/network.json`. Visitors see results instantly. They can still use their own keys to refresh if they want.

---

## Running Locally

No install needed — it's a static site:

```bash
# Option A: Python
cd Research_Network
python3 -m http.server 8080
# Open http://localhost:8080

# Option B: Node.js
npx serve
```

---

## GitHub Actions Workflow

The included `.github/workflows/deploy.yml` automatically deploys to GitHub Pages on every push to `main`. No configuration needed — just enable GitHub Pages with "GitHub Actions" as the source (Step 2 above).

If you want to deploy manually, go to **Actions** > **Deploy to GitHub Pages** > **Run workflow**.

---

## File Structure

```
Research_Network/
├── .github/workflows/
│   └── deploy.yml        # GitHub Actions → GitHub Pages
├── index.html            # Main page
├── css/
│   └── style.css         # Dark theme + glassmorphism styles
├── js/
│   ├── app.js            # Main entry, wires everything together
│   ├── config.js         # Settings modal + localStorage
│   ├── scholar.js        # Google Scholar scraping via ScraperAPI
│   ├── llm.js            # LLM calls (OpenAI / Claude / Gemini)
│   ├── network.js        # Builds node-link data structure
│   ├── graph.js          # D3.js force-directed graph
│   ├── globe.js          # 3D globe (globe.gl) with country highlighting
│   ├── countries.js      # Country name → lat/lng coordinate mapping
│   └── cache.js          # JSON export/import + merge logic
└── README.md
```

## Tech Stack

- Pure HTML/CSS/JS — no build step, no framework, no backend
- [D3.js v7](https://d3js.org/) — force-directed graph
- [globe.gl](https://globe.gl/) — 3D globe visualization
- [ScraperAPI](https://www.scraperapi.com/) — Google Scholar access
- OpenAI / Claude / Gemini — paper analysis + geolocation inference
