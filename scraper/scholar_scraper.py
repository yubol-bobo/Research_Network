#!/usr/bin/env python3
"""
Google Scholar Selenium Scraper for Research Network

Scrapes a Google Scholar profile and all citing papers using Selenium.
Outputs JSON in the format expected by the Research Network web app.

Usage:
    python scholar_scraper.py <scholar_id> [--output data/network.json]
    python scholar_scraper.py hgN6B6kAAAAJ
    python scholar_scraper.py hgN6B6kAAAAJ --headless
"""

import argparse
import json
import os
import random
import re
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional, Any

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    StaleElementReferenceException,
    ElementClickInterceptedException,
)
from webdriver_manager.chrome import ChromeDriverManager


# ── Constants ──
SCHOLAR_BASE = "https://scholar.google.com"
PAGE_LOAD_WAIT = 5
BETWEEN_REQUEST_WAIT = 4  # seconds between requests to Scholar
BETWEEN_PUB_WAIT = 5      # seconds between different publications' cited-by pages
MAX_SHOW_MORE_CLICKS = 20  # safety limit


def create_driver(headless: bool = False) -> webdriver.Chrome:
    """Create a Chrome WebDriver with anti-detection settings."""
    chrome_options = Options()
    if headless:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument(
        "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option("useAutomationExtension", False)

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver


def extract_number(text: str) -> int:
    """Extract integer from text, return 0 if not found."""
    if not text:
        return 0
    cleaned = re.sub(r"[^\d]", "", text.strip())
    return int(cleaned) if cleaned else 0


def random_delay(base: float, jitter: float = 2.0):
    """Sleep for base + random jitter seconds."""
    time.sleep(base + random.uniform(0, jitter))


def check_blocked(driver) -> bool:
    """Check if Scholar has blocked us (CAPTCHA or error page)."""
    try:
        page_text = driver.page_source.lower()
        if "unusual traffic" in page_text or "captcha" in page_text or "sorry" in page_text[:500]:
            print("  [BLOCKED] Google Scholar detected unusual traffic!")
            print("  Waiting 30 seconds before retrying...")
            time.sleep(30)
            return True
    except Exception:
        pass
    return False


# ── Profile Scraping ──


def scrape_profile_info(driver) -> Dict[str, Any]:
    """Extract basic profile info from the current Scholar profile page."""
    info = {}

    try:
        info["name"] = driver.find_element(By.ID, "gsc_prf_in").text.strip()
    except NoSuchElementException:
        info["name"] = ""

    try:
        info["affiliation"] = driver.find_element(By.CLASS_NAME, "gsc_prf_il").text.strip()
    except NoSuchElementException:
        info["affiliation"] = ""

    # Citation metrics
    try:
        table = driver.find_element(By.ID, "gsc_rsb_st")
        rows = table.find_elements(By.TAG_NAME, "tr")
        for row in rows:
            cells = row.find_elements(By.TAG_NAME, "td")
            if len(cells) >= 2:
                label = cells[0].text.strip().lower()
                value = cells[1].text.strip()
                if "citation" in label:
                    info["total_citations"] = extract_number(value)
                elif "h-index" in label:
                    info["h_index"] = extract_number(value)
                elif "i10" in label:
                    info["i10_index"] = extract_number(value)
    except NoSuchElementException:
        pass

    # Co-authors from sidebar
    info["coauthors"] = []
    try:
        coauthor_section = driver.find_element(By.ID, "gsc_rsb_co")
        links = coauthor_section.find_elements(By.CLASS_NAME, "gsc_rsb_a_desc")
        for link in links:
            try:
                name_el = link.find_element(By.TAG_NAME, "a")
                affil_el = link.find_element(By.CLASS_NAME, "gsc_rsb_a_ext")
                href = name_el.get_attribute("href") or ""
                user_match = re.search(r"user=([^&]+)", href)
                info["coauthors"].append({
                    "name": name_el.text.strip(),
                    "affiliation": affil_el.text.strip() if affil_el else "",
                    "scholarId": user_match.group(1) if user_match else "",
                })
            except (NoSuchElementException, StaleElementReferenceException):
                continue
    except NoSuchElementException:
        pass

    return info


# ── Publications Scraping ──


def load_all_publications(driver):
    """Click 'SHOW MORE' until all publications are loaded."""
    attempts = 0
    while attempts < MAX_SHOW_MORE_CLICKS:
        try:
            btn = driver.find_element(By.ID, "gsc_bpf_more")
            if not btn.is_enabled() or not btn.is_displayed():
                break
            driver.execute_script("arguments[0].click();", btn)
            time.sleep(2)
            attempts += 1
            print(f"  [SHOW MORE] clicked ({attempts})")
        except (NoSuchElementException, ElementClickInterceptedException):
            break


def scrape_publications(driver) -> List[Dict[str, Any]]:
    """Extract all publications from the profile page."""
    pubs = []
    rows = driver.find_elements(By.CSS_SELECTOR, "#gsc_a_b .gsc_a_tr")

    for row in rows:
        try:
            title_el = row.find_element(By.CLASS_NAME, "gsc_a_at")
            title = title_el.text.strip()
            if not title:
                continue

            href = title_el.get_attribute("href") or ""
            article_url = href if href.startswith("http") else (
                f"{SCHOLAR_BASE}{href}" if href else ""
            )

            # Citation count and cited-by link
            # .gsc_a_ac is itself an <a> when there are citations, or a <td> when 0
            try:
                cited_el = row.find_element(By.CSS_SELECTOR, ".gsc_a_ac")
                citation_count = extract_number(cited_el.text)
                cited_href = cited_el.get_attribute("href") or ""
                cited_by_url = cited_href if cited_href.startswith("http") else (
                    f"{SCHOLAR_BASE}{cited_href}" if cited_href else ""
                )
            except NoSuchElementException:
                citation_count = 0
                cited_by_url = ""

            # Year
            try:
                year_el = row.find_element(By.CLASS_NAME, "gsc_a_y")
                year = extract_number(year_el.text)
            except NoSuchElementException:
                year = 0

            # Authors (gray line)
            gray_els = row.find_elements(By.CLASS_NAME, "gs_gray")
            authors_str = gray_els[0].text.strip() if gray_els else ""

            pubs.append({
                "title": title,
                "articleUrl": article_url,
                "citationCount": citation_count,
                "year": year,
                "citedByUrl": cited_by_url,
                "authors": authors_str,
                "citations": [],
            })
        except (NoSuchElementException, StaleElementReferenceException):
            continue

    return pubs


# ── Paper Detail Page (full author names for user's own publications) ──


def scrape_paper_detail(driver, article_url: str) -> Dict[str, str]:
    """Visit a Scholar paper detail page and extract full info."""
    result = {"fullAuthors": "", "venue": "", "description": ""}
    if not article_url:
        return result

    try:
        driver.get(article_url)
        time.sleep(PAGE_LOAD_WAIT)

        fields = driver.find_elements(By.CSS_SELECTOR, "#gsc_oci_table .gs_scl")
        for field in fields:
            try:
                label = field.find_element(By.CLASS_NAME, "gsc_oci_field").text.strip()
                value = field.find_element(By.CLASS_NAME, "gsc_oci_value").text.strip()
                if label in ("Authors", "Inventors"):
                    result["fullAuthors"] = value
                elif label in ("Journal", "Conference", "Book"):
                    result["venue"] = value
                elif label == "Description":
                    result["description"] = value
            except NoSuchElementException:
                continue
    except Exception as e:
        print(f"  [WARN] Could not scrape paper detail: {e}")

    return result


# ── Cited-By Scraping ──


def scrape_cited_by_page(driver) -> List[Dict[str, Any]]:
    """Parse all citation entries on the current cited-by search results page."""
    citations = []
    results = driver.find_elements(By.CSS_SELECTOR, ".gs_r.gs_or.gs_scl")

    for r in results:
        try:
            # Title and link
            try:
                title_a = r.find_element(By.CSS_SELECTOR, ".gs_rt a")
                title = re.sub(r"\[.*?\]\s*", "", title_a.text).strip()
                link = title_a.get_attribute("href") or ""
            except NoSuchElementException:
                try:
                    title_el = r.find_element(By.CSS_SELECTOR, ".gs_rt")
                    title = re.sub(r"\[.*?\]\s*", "", title_el.text).strip()
                    link = ""
                except NoSuchElementException:
                    continue

            if not title:
                continue

            # Author info line: "Authors - Venue, Year - Publisher"
            try:
                author_el = r.find_element(By.CSS_SELECTOR, ".gs_a")
                author_text = author_el.text.strip()
            except NoSuchElementException:
                author_text = ""

            parts = author_text.split(" - ")
            authors = (parts[0] or "").strip() if parts else ""
            venue = (parts[1] or "").strip() if len(parts) > 1 else ""
            publisher = (parts[2] or "").strip() if len(parts) > 2 else ""

            year_match = re.search(r"(\d{4})", author_text)
            year = int(year_match.group(1)) if year_match else 0

            # Extract author profile links (Scholar user IDs) and track order
            author_profiles = {}
            author_list = []  # ordered list of all authors with metadata
            try:
                # Split the author string to get all author names in order
                raw_authors = [a.strip() for a in authors.split(",") if a.strip()]

                # Get clickable author links
                profile_anchors = author_el.find_elements(
                    By.CSS_SELECTOR, 'a[href*="/citations?user="]'
                )
                profile_map = {}
                for a in profile_anchors:
                    a_name = a.text.strip()
                    a_href = a.get_attribute("href") or ""
                    user_match = re.search(r"user=([^&]+)", a_href)
                    if a_name and user_match:
                        profile_map[a_name] = user_match.group(1)
                        author_profiles[a_name] = user_match.group(1)

                # Build ordered author list with first-author flag
                for idx, name in enumerate(raw_authors):
                    # Clean trailing ellipsis
                    clean_name = name.rstrip("…").strip()
                    if not clean_name:
                        continue
                    entry = {
                        "name": clean_name,
                        "isFirstAuthor": idx == 0,
                        "scholarId": profile_map.get(clean_name, ""),
                    }
                    author_list.append(entry)
            except NoSuchElementException:
                pass

            citations.append({
                "title": title,
                "authors": authors,
                "fullAuthors": "",  # will be filled from profile scraping
                "year": year,
                "link": link,
                "venue": venue,
                "publisher": publisher,
                "authorProfiles": author_profiles,
                "authorList": author_list,  # ordered, with isFirstAuthor flag
            })

        except (NoSuchElementException, StaleElementReferenceException):
            continue

    return citations


def scrape_all_citations(driver, cited_by_url: str, expected_count: int) -> List[Dict[str, Any]]:
    """Paginate through all 'Cited by' pages and collect all citations."""
    if not cited_by_url or expected_count == 0:
        return []

    all_citations = []
    seen_titles = set()
    page = 0
    max_pages = max(1, (expected_count // 10) + 2)  # safety margin

    current_url = cited_by_url

    while page < max_pages:
        page += 1
        driver.get(current_url)
        random_delay(PAGE_LOAD_WAIT, 2.0)

        # Check for blocking
        if check_blocked(driver):
            driver.get(current_url)
            random_delay(PAGE_LOAD_WAIT + 5, 3.0)
            if check_blocked(driver):
                print("  [BLOCKED] Still blocked after retry, stopping citation fetch")
                break

        page_citations = scrape_cited_by_page(driver)
        if not page_citations:
            break

        # Deduplicate
        new_count = 0
        for cit in page_citations:
            key = cit["title"].lower().strip()
            if key not in seen_titles:
                seen_titles.add(key)
                all_citations.append(cit)
                new_count += 1

        if new_count == 0:
            break

        # Check for next page
        if len(page_citations) >= 10:
            start_param = page * 10
            base_url = cited_by_url.split("&start=")[0]
            current_url = f"{base_url}&start={start_param}"
            random_delay(BETWEEN_REQUEST_WAIT, 2.0)
        else:
            break

    return all_citations


# ── Scholar Profile Scraping ──


def scrape_author_profile(driver, scholar_id: str) -> Dict[str, Any]:
    """
    Visit a Scholar author's profile page and extract:
    - Full name
    - Total citations
    - Institution/affiliation
    - Country (from affiliation if visible)
    """
    result = {
        "fullName": "",
        "totalCitations": 0,
        "institution": "",
        "scholarId": scholar_id,
    }

    try:
        url = f"{SCHOLAR_BASE}/citations?user={scholar_id}&hl=en"
        driver.get(url)
        random_delay(PAGE_LOAD_WAIT, 2.0)

        if check_blocked(driver):
            driver.get(url)
            random_delay(PAGE_LOAD_WAIT + 5, 3.0)
            if check_blocked(driver):
                return result

        # Full name
        try:
            result["fullName"] = driver.find_element(By.ID, "gsc_prf_in").text.strip()
        except NoSuchElementException:
            pass

        # Institution
        try:
            result["institution"] = driver.find_element(By.CSS_SELECTOR, ".gsc_prf_il").text.strip()
        except NoSuchElementException:
            pass

        # Total citations from the stats table
        try:
            table = driver.find_element(By.ID, "gsc_rsb_st")
            rows = table.find_elements(By.TAG_NAME, "tr")
            for row in rows:
                cells = row.find_elements(By.TAG_NAME, "td")
                if len(cells) >= 2:
                    label = cells[0].text.strip().lower()
                    if "citation" in label:
                        result["totalCitations"] = extract_number(cells[1].text)
                        break
        except NoSuchElementException:
            pass

    except Exception as e:
        print(f"    [WARN] Failed to scrape profile {scholar_id}: {e}")

    return result


def fetch_all_author_profiles(
    driver,
    publications: List[Dict],
    existing_profiles: Dict[str, Dict],
) -> Dict[str, Dict]:
    """
    Collect all unique Scholar IDs from citing papers' authorList,
    then visit each profile to get full name + total citations + institution.
    Returns a dict: { scholarId: { fullName, totalCitations, institution, scholarId } }
    """
    # Collect all unique Scholar IDs and track first-author status
    scholar_ids = {}  # scholarId -> { abbrevName, isFirstAuthor (of any citing paper) }
    for pub in publications:
        for cit in pub.get("citations", []):
            for author in cit.get("authorList", []):
                sid = author.get("scholarId", "")
                if sid and sid not in scholar_ids:
                    scholar_ids[sid] = {
                        "abbrevName": author["name"],
                        "isFirstAuthor": author["isFirstAuthor"],
                    }
                elif sid and author["isFirstAuthor"]:
                    # Mark as first author if they are first author of ANY citing paper
                    scholar_ids[sid]["isFirstAuthor"] = True

    # Filter out already-fetched profiles
    to_fetch = {
        sid: info for sid, info in scholar_ids.items()
        if sid not in existing_profiles or not existing_profiles[sid].get("fullName")
    }

    print(f"  Found {len(scholar_ids)} unique Scholar IDs, {len(to_fetch)} need fetching")

    profiles = dict(existing_profiles)  # start with existing

    for i, (sid, info) in enumerate(to_fetch.items()):
        print(f"  [{i+1}/{len(to_fetch)}] Fetching profile: {info['abbrevName']} ({sid})...")
        profile = scrape_author_profile(driver, sid)
        if profile["fullName"]:
            print(f"    → {profile['fullName']} | {profile['totalCitations']} citations | {profile['institution'][:50]}")
        else:
            print(f"    → (profile not found)")
        profiles[sid] = profile
        random_delay(BETWEEN_REQUEST_WAIT, 2.0)

    return profiles


# ── Full Author Name Fetching (from paper links) ──


def fetch_full_authors_from_link(driver, paper_url: str) -> str:
    """Visit a paper's page and try to extract full author names."""
    if not paper_url:
        return ""

    try:
        driver.get(paper_url)
        time.sleep(PAGE_LOAD_WAIT)

        # Method 1: meta tags (works on arXiv, ACM, IEEE, Springer, etc.)
        meta_plural = driver.find_elements(By.CSS_SELECTOR, 'meta[name="citation_authors"]')
        if meta_plural:
            content = meta_plural[0].get_attribute("content")
            if content and content.strip():
                return content.strip()

        meta_singles = driver.find_elements(By.CSS_SELECTOR, 'meta[name="citation_author"]')
        if meta_singles:
            authors = [m.get_attribute("content").strip() for m in meta_singles if m.get_attribute("content")]
            if authors:
                return ", ".join(authors)

        # Method 2: Scholar paper detail page
        fields = driver.find_elements(By.CSS_SELECTOR, "#gsc_oci_table .gs_scl")
        for field in fields:
            try:
                label = field.find_element(By.CLASS_NAME, "gsc_oci_field").text.strip()
                if label in ("Authors", "Inventors"):
                    return field.find_element(By.CLASS_NAME, "gsc_oci_value").text.strip()
            except NoSuchElementException:
                continue

        return ""
    except Exception as e:
        print(f"    [WARN] Failed to fetch authors from {paper_url}: {e}")
        return ""


# ── Main Scraping Flow ──


def scrape_scholar(
    scholar_id: str,
    headless: bool = False,
    fetch_full_authors: bool = True,
    existing_data: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Full scraping pipeline:
    1. Load profile, get info
    2. Load all publications
    3. For each pub with citations, scrape all cited-by pages
    4. Optionally fetch full author names for citing papers
    """
    print(f"{'='*60}")
    print(f"Scraping Google Scholar profile: {scholar_id}")
    print(f"{'='*60}\n")

    # Build cache from existing data
    cache = {}
    if existing_data and "publications" in existing_data:
        for pub in existing_data["publications"]:
            cache[pub["title"]] = pub

    driver = create_driver(headless=headless)

    try:
        # Step 1: Load profile page
        profile_url = f"{SCHOLAR_BASE}/citations?user={scholar_id}&hl=en"
        print(f"[1/4] Loading profile: {profile_url}")
        driver.get(profile_url)
        time.sleep(PAGE_LOAD_WAIT)

        # Extract profile info
        profile_info = scrape_profile_info(driver)
        researcher_name = profile_info.get("name", "Researcher")
        print(f"  Name: {researcher_name}")
        print(f"  Affiliation: {profile_info.get('affiliation', 'N/A')}")
        print(f"  Total Citations: {profile_info.get('total_citations', 'N/A')}")
        print(f"  H-index: {profile_info.get('h_index', 'N/A')}")
        print(f"  Co-authors: {len(profile_info.get('coauthors', []))}")

        # Step 2: Load all publications
        print(f"\n[2/4] Loading all publications...")
        load_all_publications(driver)
        publications = scrape_publications(driver)
        print(f"  Found {len(publications)} publications")

        # Step 3: Fetch citations for each publication
        print(f"\n[3/4] Fetching citations for each publication...")
        total_citations = 0
        for i, pub in enumerate(publications):
            if pub["citationCount"] == 0:
                print(f"  [{i+1}/{len(publications)}] {pub['title'][:60]} — 0 citations, skipping")
                continue

            # Check cache
            if pub["title"] in cache:
                cached = cache[pub["title"]]
                cached_cits = cached.get("citations", [])
                has_full = all(c.get("fullAuthors") for c in cached_cits) if cached_cits else False
                if len(cached_cits) >= pub["citationCount"] and has_full:
                    pub["citations"] = cached_cits
                    total_citations += len(cached_cits)
                    print(f"  [{i+1}/{len(publications)}] {pub['title'][:60]} — {len(cached_cits)} cached ✓")
                    continue

            print(f"  [{i+1}/{len(publications)}] {pub['title'][:60]} — fetching {pub['citationCount']} citations...")
            citations = scrape_all_citations(driver, pub["citedByUrl"], pub["citationCount"])

            # If scraping returned 0 but we expect citations, Scholar may have blocked us
            # Fall back to cached citations if available
            if len(citations) == 0 and pub["citationCount"] > 0 and pub["title"] in cache:
                cached_cits = cache[pub["title"]].get("citations", [])
                if cached_cits:
                    pub["citations"] = cached_cits
                    total_citations += len(cached_cits)
                    print(f"    → blocked, using {len(cached_cits)} cached citations")
                    random_delay(BETWEEN_PUB_WAIT, 3.0)
                    continue

            pub["citations"] = citations
            total_citations += len(citations)
            print(f"    → got {len(citations)} citations")

            random_delay(BETWEEN_PUB_WAIT, 3.0)

        print(f"\n  Total citing papers collected: {total_citations}")

        # Step 4: Fetch Scholar profiles for citing authors
        # This gets verified full names, total citations, and institutions
        # by visiting clickable author links directly on Scholar
        existing_profiles = existing_data.get("scholarProfiles", {}) if existing_data else {}
        scholar_profiles = {}

        if fetch_full_authors:
            print(f"\n[4/5] Fetching Scholar profiles for citing authors...")
            scholar_profiles = fetch_all_author_profiles(
                driver, publications, existing_profiles
            )

            # Backfill fullAuthors on citations using profile data
            print(f"\n[5/5] Backfilling full author names from profiles...")
            for pub in publications:
                for cit in pub.get("citations", []):
                    if cit.get("fullAuthors"):
                        continue  # already have full names
                    # Build full author string from authorList + profiles
                    full_names = []
                    for author in cit.get("authorList", []):
                        sid = author.get("scholarId", "")
                        if sid and sid in scholar_profiles and scholar_profiles[sid].get("fullName"):
                            full_names.append(scholar_profiles[sid]["fullName"])
                        else:
                            full_names.append(author["name"])
                    if full_names:
                        cit["fullAuthors"] = ", ".join(full_names)
        else:
            print(f"\n[4/5] Skipping author profile fetch (--no-full-authors)")
            print(f"[5/5] Skipping backfill")

        # Build authorCitations from scholar profiles
        author_citations = {}
        for sid, profile in scholar_profiles.items():
            if profile.get("fullName") and profile.get("totalCitations", 0) > 0:
                author_citations[profile["fullName"]] = profile["totalCitations"]

        # Build output
        output = {
            "version": 1,
            "exportedAt": datetime.now().isoformat(),
            "scholarId": scholar_id,
            "researcher": researcher_name,
            "profileInfo": profile_info,
            "publications": publications,
            "scholarProfiles": scholar_profiles,
            "authorCitations": author_citations,
            "geoData": existing_data.get("geoData", {}) if existing_data else {},
            "themes": existing_data.get("themes", {}) if existing_data else {},
            "summaries": existing_data.get("summaries", {}) if existing_data else {},
        }

        return output

    finally:
        driver.quit()
        print("\nBrowser closed.")


def main():
    parser = argparse.ArgumentParser(
        description="Scrape Google Scholar profile for Research Network"
    )
    parser.add_argument("scholar_id", help="Google Scholar user ID (e.g., hgN6B6kAAAAJ)")
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output JSON file path (default: data/<scholar_id>_network.json)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run Chrome in headless mode (no browser window)",
    )
    parser.add_argument(
        "--no-full-authors",
        action="store_true",
        help="Skip fetching full author names (faster but less data)",
    )
    parser.add_argument(
        "--existing",
        default=None,
        help="Path to existing network.json to use as cache and preserve geo/theme data",
    )

    args = parser.parse_args()

    # Determine output path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)

    if args.output:
        output_path = args.output
    else:
        output_path = os.path.join(project_dir, "data", "network.json")

    # Load existing data if specified
    existing_data = None
    if args.existing:
        try:
            with open(args.existing, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
            print(f"Loaded existing data from {args.existing}")
        except Exception as e:
            print(f"Warning: Could not load existing data: {e}")

    # Also try loading the output file as cache if no --existing specified
    if not existing_data and os.path.exists(output_path):
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
            print(f"Using existing output file as cache: {output_path}")
        except Exception:
            pass

    # Scrape
    data = scrape_scholar(
        scholar_id=args.scholar_id,
        headless=args.headless,
        fetch_full_authors=not args.no_full_authors,
        existing_data=existing_data,
    )

    # Save
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"DONE! Output saved to: {output_path}")
    print(f"{'='*60}")
    print(f"  Researcher: {data['researcher']}")
    print(f"  Publications: {len(data['publications'])}")
    total_cits = sum(len(p.get('citations', [])) for p in data['publications'])
    print(f"  Total citing papers collected: {total_cits}")
    print(f"\nTo use in the web app:")
    print(f"  1. Copy to data/network.json (if not already there)")
    print(f"  2. Push to GitHub")
    print(f"  3. Visitors see your analysis at your GitHub Pages URL")


if __name__ == "__main__":
    main()
