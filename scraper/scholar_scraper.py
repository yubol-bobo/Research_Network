#!/usr/bin/env python3
"""
Google Scholar Selenium Scraper for Research Network

Scrapes a Google Scholar profile and all citing papers using Selenium.
Supports incremental updates: compares existing data with current Scholar page
and only fetches new/changed publications and citations.

Usage:
    python scraper/scholar_scraper.py <scholar_id>
    python scraper/scholar_scraper.py hgN6B6kAAAAJ
    python scraper/scholar_scraper.py hgN6B6kAAAAJ --headless
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
BETWEEN_REQUEST_WAIT = 4
BETWEEN_PUB_WAIT = 5
MAX_SHOW_MORE_CLICKS = 20


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
    if not text:
        return 0
    cleaned = re.sub(r"[^\d]", "", text.strip())
    return int(cleaned) if cleaned else 0


def random_delay(base: float, jitter: float = 2.0):
    time.sleep(base + random.uniform(0, jitter))


def check_blocked(driver) -> bool:
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


# ── Country Inference Engine (ported from globe.js) ──

INSTITUTION_PATTERNS = [
    # US
    (r'Carnegie Mellon|Stanford|MIT\b|Harvard|Berkeley|Caltech|Princeton|Yale|Columbia|Cornell|University of (California|Michigan|Washington|Pennsylvania|Illinois|Texas|Wisconsin|Virginia|Maryland|Florida|Georgia|Colorado|Arizona|Oregon|Minnesota|Indiana|Iowa|Massachusetts|North Carolina|South Carolina|Chicago|Pittsburgh|Rochester|Notre Dame|Southern California|Central Florida|Utah|Kentucky|Kansas|Nebraska|Hawaii|Tennessee|Missouri|Oklahoma|Cincinnati|Delaware|Nevada|New Mexico|Vermont|Connecticut|Rhode Island|New Hampshire|Maine|Montana|Idaho|Wyoming|Alabama|Mississippi|Arkansas|Louisiana|West Virginia)|Georgia (Tech|Institute)|Johns Hopkins|Duke|Northwestern|Rice|Emory|Vanderbilt|Brown|Dartmouth|Penn(sylvania)? State|Ohio State|Purdue|Michigan State|Arizona State|USC\b|UCLA|UCSB|UCSD|UCSC|UC Davis|UC Irvine|Case Western|Stony Brook|Rutgers|NYU\b|Boston University|Rochester|Syracuse|Drexel|Tulane|Lehigh|CMU\b|UIUC|UMass|UConn|UMD\b|UVA\b|UNC\b|UT Austin|UT Dallas|SUNY|Northeastern University|Georgetown|Wake Forest|Tufts|Brandeis|George Washington|American University|Temple|Villanova|Fordham|IBM Research|Google|Microsoft|Meta\b|Amazon|OpenAI|NVIDIA|Apple\b|Adobe|Salesforce|Intel\b|Qualcomm|Oracle', 'United States'),
    # China
    (r'Tsinghua|Peking University|Fudan|Zhejiang|Shang\s*hai|Nanjing|Wuhan|Huazhong|Sun Yat|Harbin|USTC|ECNU|East China|CAS\b|Chinese Academy|Science and Technology of China|Beihang|Beijing|Renmin|Sichuan|Jilin|Tongji|Xiamen|Nankai|Southeast University|Central South|SJTU|HUST|Zhengzhou|Shandong|Tianjin|Dalian|Xidian|Northwestern Polytechnical|Southwest Jiaotong|Tencent|Baidu|Alibaba|ByteDance|Huawei|Xiaomi|JD\b|DiDi|SenseTime|Megvii|CUHK\b|Hong Kong|HKUST|HKU\b|Lingnan|National Taiwan|NTHU|NCTU|Academia Sinica', 'China'),
    # UK
    (r'Oxford|Cambridge|Imperial College|UCL\b|University College of London|Edinburgh|Manchester|Bristol|Warwick|Glasgow|Leeds|Sheffield|Southampton|Birmingham|Liverpool|Nottingham|Queen Mary|King.s College|LSE|London School|St Andrews|Durham|Exeter|Bath|York|Sussex|Surrey|Lancaster|Leicester|Aberdeen|Heriot|Newcastle|Reading|Cardiff|Swansea|Hertfordshire|Kent|Essex|Cranfield|Brunel|Plymouth|Portsmouth|Stirling|Strathclyde|Dundee|Aston|Keele|Bangor|Ulster|Brighton|Coventry', 'United Kingdom'),
    # Switzerland
    (r'ETH\b|EPFL|Zurich|Zürich|Geneva|Basel|Bern|Lausanne|IDIAP', 'Switzerland'),
    # Germany
    (r'Munich|TU Berlin|Heidelberg|Bonn|Freiburg|Hamburg|Frankfurt|Stuttgart|Leipzig|Göttingen|Tübingen|RWTH|Karlsruhe|TU Darmstadt|Saarland|Max Planck|Fraunhofer|Humboldt|Dresden|Siemens|Siegen|Mannheim|Bielefeld|Potsdam|Konstanz|Rostock|Jena|Mainz|Würzburg', 'Germany'),
    # Canada
    (r'Toronto|McGill|UBC\b|Waterloo|Montreal|Montréal|Alberta|Ottawa|Calgary|Simon Fraser|McMaster|Dalhousie|Manitoba|Saskatchewan|Laval|Mila\b|Vector Institute|CIFAR|Concordia', 'Canada'),
    # France
    (r'Sorbonne|ENS\b|Ecole Polytechnique|INRIA|CNRS|Paris|Grenoble|Lyon|Toulouse|Marseille|Strasbourg|Bordeaux|Lille|Nantes|CentraleSupélec|Télécom|Sciences Po|HEC\b|INSEAD', 'France'),
    # Japan
    (r'Tokyo|Kyoto|Osaka|Tohoku|Nagoya|Hokkaido|Kyushu|Waseda|Keio|Tsukuba|NAIST|NICT|RIKEN|NTT\b|Sony|Hitachi|Fujitsu', 'Japan'),
    # South Korea
    (r'Seoul|KAIST|POSTECH|Korea University|Yonsei|Hanyang|Sungkyunkwan|Ewha|Sogang|Samsung|Naver|Kakao', 'South Korea'),
    # India
    (r'IIT\b|IISc|IIIT|Indian Institute|Indian Statistical|Jawaharlal|BITS Pilani|NIT\b|Tata\b|Infosys|Wipro|TCS\b|Rangasamy|VIT\b|SRM\b|Manipal|Amity|KIIT|Jadavpur|Anna University', 'India'),
    # Australia
    (r'Sydney|Melbourne|Queensland|Monash|ANU\b|Australian National|UNSW|CSIRO|Adelaide|Western Australia|Macquarie|Griffith|Deakin|Curtin|Tasmania|Wollongong', 'Australia'),
    # Singapore
    (r'National University of Singapore|NUS\b|NTU.*Singapore|Nanyang|SUTD|Singapore Management|A\*STAR', 'Singapore'),
    # Netherlands
    (r'Amsterdam|Delft|Utrecht|Leiden|Eindhoven|Groningen|Twente|Erasmus|Tilburg|Radboud|Wageningen', 'Netherlands'),
    # Israel
    (r'Technion|Hebrew University|Tel Aviv|Weizmann|Ben-?Gurion|Bar-?Ilan', 'Israel'),
    # Italy
    (r'Sapienza|Politecnico|Bocconi|Trento', 'Italy'),
    # Spain
    (r'Salamanca|Basque', 'Spain'),
    # Sweden
    (r'KTH\b|Chalmers|Linköping', 'Sweden'),
    # Denmark
    (r'DTU\b|Aalborg', 'Denmark'),
    # Finland
    (r'Aalto', 'Finland'),
    # Brazil
    (r'USP\b|UNICAMP|UFRJ|PUC.*Rio', 'Brazil'),
    # Qatar
    (r'HBKU|Hamad Bin', 'Qatar'),
    # Saudi Arabia
    (r'KAUST|King Abdullah|King Saud|King Fahd|KFUPM', 'Saudi Arabia'),
    # UAE
    (r'MBZUAI|NYU Abu Dhabi|Khalifa|Mohamed bin Zayed', 'United Arab Emirates'),
]

# Country names (direct mention in institution string)
COUNTRY_NAMES = [
    ('United States', 'United States'), ('United Kingdom', 'United Kingdom'),
    ('South Korea', 'South Korea'), ('North Korea', 'North Korea'),
    ('South Africa', 'South Africa'), ('New Zealand', 'New Zealand'),
    ('Saudi Arabia', 'Saudi Arabia'), ('Sri Lanka', 'Sri Lanka'),
    ('Costa Rica', 'Costa Rica'), ('Puerto Rico', 'United States'),
    ('Czech Republic', 'Czech Republic'),
    ('Hong Kong', 'China'), ('Macau', 'China'), ('Macao', 'China'),
    ('Taiwan', 'China'),
    ('USA', 'United States'), ('U.S.A', 'United States'), ('U.S.', 'United States'),
    ('U.K.', 'United Kingdom'),
    ('UAE', 'United Arab Emirates'),
    ('P.R. China', 'China'), ('PR China', 'China'), ('PRC', 'China'),
    ('Afghanistan', 'Afghanistan'), ('Albania', 'Albania'), ('Algeria', 'Algeria'),
    ('Argentina', 'Argentina'), ('Armenia', 'Armenia'), ('Australia', 'Australia'),
    ('Austria', 'Austria'), ('Azerbaijan', 'Azerbaijan'),
    ('Bahrain', 'Bahrain'), ('Bangladesh', 'Bangladesh'), ('Belarus', 'Belarus'),
    ('Belgium', 'Belgium'), ('Bolivia', 'Bolivia'), ('Bosnia', 'Bosnia and Herzegovina'),
    ('Botswana', 'Botswana'), ('Brazil', 'Brazil'), ('Brunei', 'Brunei'),
    ('Bulgaria', 'Bulgaria'), ('Cambodia', 'Cambodia'), ('Cameroon', 'Cameroon'),
    ('Canada', 'Canada'), ('Chile', 'Chile'), ('China', 'China'),
    ('Colombia', 'Colombia'), ('Croatia', 'Croatia'), ('Cuba', 'Cuba'),
    ('Cyprus', 'Cyprus'), ('Czechia', 'Czech Republic'),
    ('Denmark', 'Denmark'),
    ('Ecuador', 'Ecuador'), ('Egypt', 'Egypt'), ('Estonia', 'Estonia'),
    ('Ethiopia', 'Ethiopia'), ('Finland', 'Finland'), ('France', 'France'),
    ('Georgia', 'Georgia'), ('Germany', 'Germany'), ('Ghana', 'Ghana'),
    ('Greece', 'Greece'), ('Guatemala', 'Guatemala'),
    ('Hungary', 'Hungary'), ('Iceland', 'Iceland'), ('India', 'India'),
    ('Indonesia', 'Indonesia'), ('Iran', 'Iran'), ('Iraq', 'Iraq'),
    ('Ireland', 'Ireland'), ('Israel', 'Israel'), ('Italy', 'Italy'),
    ('Jamaica', 'Jamaica'), ('Japan', 'Japan'), ('Jordan', 'Jordan'),
    ('Kazakhstan', 'Kazakhstan'), ('Kenya', 'Kenya'), ('Kuwait', 'Kuwait'),
    ('Kyrgyzstan', 'Kyrgyzstan'),
    ('Latvia', 'Latvia'), ('Lebanon', 'Lebanon'), ('Libya', 'Libya'),
    ('Lithuania', 'Lithuania'), ('Luxembourg', 'Luxembourg'),
    ('Malaysia', 'Malaysia'), ('Mexico', 'Mexico'), ('Moldova', 'Moldova'),
    ('Mongolia', 'Mongolia'), ('Montenegro', 'Montenegro'), ('Morocco', 'Morocco'),
    ('Myanmar', 'Myanmar'), ('Nepal', 'Nepal'), ('Netherlands', 'Netherlands'),
    ('Nigeria', 'Nigeria'), ('Norway', 'Norway'),
    ('Oman', 'Oman'), ('Pakistan', 'Pakistan'), ('Palestine', 'Palestine'),
    ('Panama', 'Panama'), ('Paraguay', 'Paraguay'), ('Peru', 'Peru'),
    ('Philippines', 'Philippines'), ('Poland', 'Poland'), ('Portugal', 'Portugal'),
    ('Qatar', 'Qatar'), ('Romania', 'Romania'), ('Russia', 'Russia'),
    ('Rwanda', 'Rwanda'),
    ('Senegal', 'Senegal'), ('Serbia', 'Serbia'), ('Singapore', 'Singapore'),
    ('Slovakia', 'Slovakia'), ('Slovenia', 'Slovenia'), ('Somalia', 'Somalia'),
    ('Spain', 'Spain'), ('Sudan', 'Sudan'), ('Sweden', 'Sweden'),
    ('Switzerland', 'Switzerland'), ('Syria', 'Syria'),
    ('Thailand', 'Thailand'), ('Tunisia', 'Tunisia'), ('Turkey', 'Turkey'),
    ('Türkiye', 'Turkey'),
    ('Uganda', 'Uganda'), ('Ukraine', 'Ukraine'),
    ('Uruguay', 'Uruguay'), ('Uzbekistan', 'Uzbekistan'),
    ('Venezuela', 'Venezuela'), ('Vietnam', 'Vietnam'), ('Viet Nam', 'Vietnam'),
    ('Yemen', 'Yemen'), ('Zambia', 'Zambia'), ('Zimbabwe', 'Zimbabwe'),
    ('Korean', 'South Korea'), ('Japanese', 'Japan'), ('Chinese', 'China'),
    ('Brazilian', 'Brazil'), ('Mexican', 'Mexico'), ('Russian', 'Russia'),
    ('Turkish', 'Turkey'), ('Polish', 'Poland'), ('Swedish', 'Sweden'),
    ('Norwegian', 'Norway'), ('Danish', 'Denmark'), ('Finnish', 'Finland'),
    ('Scottish', 'United Kingdom'), ('Welsh', 'United Kingdom'),
]

CITY_PATTERNS = [
    (r'\bMilan\b|Rome\b|Turin\b|Bologna\b|Padua\b|Pisa\b|Florence\b', 'Italy'),
    (r'\bBarcelona\b|Madrid\b|Valencia\b|Seville\b|Granada\b', 'Spain'),
    (r'\bStockholm\b|Uppsala\b|Lund\b|Gothenburg\b', 'Sweden'),
    (r'\bCopenhagen\b|Aarhus\b', 'Denmark'),
    (r'\bHelsinki\b|Turku\b|Tampere\b|Oulu\b', 'Finland'),
    (r'\bSão Paulo\b|Campinas\b|Rio de Janeiro\b', 'Brazil'),
    (r'\bBangkok\b|Chiang Mai\b|Chulalongkorn', 'Thailand'),
    (r'\bLagos\b|Ibadan\b|Abuja\b', 'Nigeria'),
    (r'\bNairobi\b|Mombasa\b', 'Kenya'),
    (r'\bCape Town\b|Johannesburg\b|Pretoria\b|Stellenbosch\b|Witwatersrand', 'South Africa'),
    (r'\bDublin\b|Trinity College Dublin|University College Dublin', 'Ireland'),
    (r'\bLisbon\b|Porto\b|Coimbra\b', 'Portugal'),
    (r'\bVienna\b|Graz\b|Innsbruck\b', 'Austria'),
    (r'\bWarsaw\b|Kraków\b|Krakow\b|Wroclaw\b|Gdansk\b|Poznan\b', 'Poland'),
    (r'\bPrague\b|Brno\b', 'Czech Republic'),
    (r'\bBudapest\b|Debrecen\b', 'Hungary'),
    (r'\bBucharest\b|Cluj\b', 'Romania'),
    (r'\bAthens\b|Thessaloniki\b', 'Greece'),
    (r'\bBelgrade\b|Novi Sad\b', 'Serbia'),
    (r'\bZagreb\b', 'Croatia'),
    (r'\bLjubljana\b', 'Slovenia'),
    (r'\bBratislava\b|Košice\b', 'Slovakia'),
    (r'\bTallinn\b|Tartu\b', 'Estonia'),
    (r'\bRiga\b', 'Latvia'),
    (r'\bVilnius\b|Kaunas\b', 'Lithuania'),
    (r'\bOslo\b|Bergen\b|Trondheim\b|NTNU\b', 'Norway'),
    (r'\bKuala Lumpur\b|Malaya\b', 'Malaysia'),
    (r'\bJakarta\b|Bandung\b|Gadjah Mada', 'Indonesia'),
    (r'\bManila\b|Ateneo\b|De La Salle', 'Philippines'),
    (r'\bHanoi\b|Ho Chi Minh', 'Vietnam'),
    (r'\bDelhi\b|Mumbai\b|Bangalore\b|Bengaluru\b|Hyderabad\b|Chennai\b|Kolkata\b|Pune\b', 'India'),
    (r'\bDoha\b', 'Qatar'),
    (r'\bDubai\b|Abu Dhabi\b', 'United Arab Emirates'),
    (r'\bRiyadh\b|Jeddah\b', 'Saudi Arabia'),
    (r'\bTehran\b|Isfahan\b|Sharif\b', 'Iran'),
    (r'\bAnkara\b|Istanbul\b|Izmir\b|Boğaziçi|Bilkent|Koç University', 'Turkey'),
    (r'\bCairo\b|Alexandria\b', 'Egypt'),
    (r'\bMoscow\b|Saint Petersburg\b|Novosibirsk\b|Skolkovo\b|Skoltech', 'Russia'),
    (r'\bKyiv\b|Kiev\b|Kharkiv\b|Lviv\b', 'Ukraine'),
    (r'\bSantiago\b.*Chile|Pontificia Universidad Católica de Chile', 'Chile'),
    (r'\bBuenos Aires\b', 'Argentina'),
    (r'\bBogotá\b|Bogota\b|Medellín\b|Medellin\b', 'Colombia'),
    (r'\bLima\b.*Peru|Pontificia Universidad Católica del Perú', 'Peru'),
    (r'\bMexico City\b|Ciudad de México\b|UNAM\b|Tecnológico de Monterrey|Monterrey\b', 'Mexico'),
]

# Pre-compile all patterns
_COMPILED_INSTITUTION = [(re.compile(p, re.IGNORECASE), c) for p, c in INSTITUTION_PATTERNS]
_COMPILED_COUNTRY_NAMES = [(re.compile(r'\b' + re.escape(n) + r'\b', re.IGNORECASE), c) for n, c in COUNTRY_NAMES]
_COMPILED_CITY = [(re.compile(p, re.IGNORECASE), c) for p, c in CITY_PATTERNS]


def infer_country(institution: str) -> str:
    """Infer country from an institution string using three-tier approach."""
    if not institution:
        return ''
    for pattern, country in _COMPILED_INSTITUTION:
        if pattern.search(institution):
            return country
    for pattern, country in _COMPILED_COUNTRY_NAMES:
        if pattern.search(institution):
            return country
    for pattern, country in _COMPILED_CITY:
        if pattern.search(institution):
            return country
    return ''


def clean_institution(raw: str) -> str:
    """Clean institution string to show only the university/organization name."""
    if not raw or raw == '—':
        return raw
    if re.match(r'^unknown', raw, re.IGNORECASE):
        return '—'

    cleaned = raw

    # Handle "@ University" pattern
    at_parts = re.split(r'(?:,\s*)?(?:@|(?:\bat\b))\s*', cleaned, flags=re.IGNORECASE)
    at_parts = [p for p in at_parts if p.strip()]
    if len(at_parts) > 1:
        cleaned = at_parts[-1].strip()

    # Split by comma and find institution part
    parts = [p.strip() for p in cleaned.split(',')]
    if len(parts) > 1:
        inst_start = -1
        for i in range(len(parts) - 1, -1, -1):
            part = parts[i].strip()
            # Skip title/role parts
            if re.match(r'^(PhD|Ph\.?D|Professor|Prof\.|Postdoc|Post-?doc|Research|Assistant|Associate|Senior|Junior|Distinguished|Visiting|Director|Fellow|Lecturer|Student|Candidate|Engineer|Scientist|Master|Doctoral|Founder|CEO|CTO|Co-?founder|AI |ML |NLP |Software |Data )', part, re.IGNORECASE):
                continue
            if re.match(r'^(Department|Dept|School|Faculty|College|Division|Center|Centre|Lab|Group|Institute|Program) (of|for|in) ', part, re.IGNORECASE):
                continue
            if len(part) < 3:
                continue
            if re.match(r'^(MS|MSc|MA|MBA|BS|BSc|BA|MPhil|CSE|ECE|EE|CS|SE)\b', part, re.IGNORECASE) and len(part) < 15:
                continue
            # Strong institution signal
            if re.search(r'University|Institut|College|Polytechnic|School of|Academy|Labs?$|Inc\.|Corp|Google|Microsoft|Meta|Amazon|DeepMind|OpenAI|NVIDIA', part, re.IGNORECASE):
                inst_start = i
                break
            inst_start = i
            break

        if inst_start >= 0:
            if inst_start > 0:
                prev = parts[inst_start - 1].strip()
                if re.search(r'University of|Institut[eo]? (of|de|für)|Universit[éyà]', prev, re.IGNORECASE):
                    inst_start -= 1
            cleaned = ', '.join(parts[inst_start:]).strip()

    # Clean remaining prefixes
    cleaned = re.sub(r'^(and |& )?(Head|Director|Chair|Dean|Professor|Fellow|Member) (of |at |in )*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'^\s*[,;]\s*', '', cleaned).strip()

    if len(cleaned) < 3:
        return raw
    return cleaned


def build_geo_data(publications: List[Dict], scholar_profiles: Dict[str, Dict]) -> Dict[str, Dict]:
    """
    Build geo data from scholarProfiles for all citations.
    Returns { "pubIdx_citIdx": { country, institution } }
    """
    geo_data = {}

    for pi, pub in enumerate(publications):
        for ci, cit in enumerate(pub.get("citations", [])):
            author_list = cit.get("authorList", [])

            # Try first author first, then any author
            first_authors = [a for a in author_list if a.get("isFirstAuthor")]
            effective = first_authors[:1] if first_authors else (author_list[:1] if author_list else [])

            for author in effective:
                sid = author.get("scholarId", "")
                if not sid:
                    continue
                profile = scholar_profiles.get(sid, {})
                institution = profile.get("institution", "")
                country = infer_country(institution)
                if country or institution:
                    cleaned_inst = clean_institution(institution)
                    if cleaned_inst == '—':
                        cleaned_inst = ''
                    geo_data[f"{pi}_{ci}"] = {"country": country, "institution": cleaned_inst}
                    break

            # If no geo from first author, try all authors
            if f"{pi}_{ci}" not in geo_data:
                for author in author_list:
                    sid = author.get("scholarId", "")
                    if not sid:
                        continue
                    profile = scholar_profiles.get(sid, {})
                    institution = profile.get("institution", "")
                    country = infer_country(institution)
                    if country or institution:
                        cleaned_inst = clean_institution(institution)
                        if cleaned_inst == '—':
                            cleaned_inst = ''
                        geo_data[f"{pi}_{ci}"] = {"country": country, "institution": cleaned_inst}
                        break

    return geo_data


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

            try:
                year_el = row.find_element(By.CLASS_NAME, "gsc_a_y")
                year = extract_number(year_el.text)
            except NoSuchElementException:
                year = 0

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


# ── Cited-By Scraping ──


def scrape_cited_by_page(driver) -> List[Dict[str, Any]]:
    citations = []
    results = driver.find_elements(By.CSS_SELECTOR, ".gs_r.gs_or.gs_scl")

    for r in results:
        try:
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

            author_profiles = {}
            author_list = []
            try:
                raw_authors = [a.strip() for a in authors.split(",") if a.strip()]
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

                for idx, name in enumerate(raw_authors):
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
                "fullAuthors": "",
                "year": year,
                "link": link,
                "venue": venue,
                "publisher": publisher,
                "authorProfiles": author_profiles,
                "authorList": author_list,
            })

        except (NoSuchElementException, StaleElementReferenceException):
            continue

    return citations


def scrape_all_citations(driver, cited_by_url: str, expected_count: int) -> List[Dict[str, Any]]:
    if not cited_by_url or expected_count == 0:
        return []

    all_citations = []
    seen_titles = set()
    page = 0
    max_pages = max(1, (expected_count // 10) + 2)
    current_url = cited_by_url

    while page < max_pages:
        page += 1
        driver.get(current_url)
        random_delay(PAGE_LOAD_WAIT, 2.0)

        if check_blocked(driver):
            driver.get(current_url)
            random_delay(PAGE_LOAD_WAIT + 5, 3.0)
            if check_blocked(driver):
                print("  [BLOCKED] Still blocked after retry, stopping citation fetch")
                break

        page_citations = scrape_cited_by_page(driver)
        if not page_citations:
            break

        new_count = 0
        for cit in page_citations:
            key = cit["title"].lower().strip()
            if key not in seen_titles:
                seen_titles.add(key)
                all_citations.append(cit)
                new_count += 1

        if new_count == 0:
            break

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

        try:
            result["fullName"] = driver.find_element(By.ID, "gsc_prf_in").text.strip()
        except NoSuchElementException:
            pass

        try:
            result["institution"] = driver.find_element(By.CSS_SELECTOR, ".gsc_prf_il").text.strip()
        except NoSuchElementException:
            pass

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
    scholar_ids = {}
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
                    scholar_ids[sid]["isFirstAuthor"] = True

    to_fetch = {
        sid: info for sid, info in scholar_ids.items()
        if sid not in existing_profiles or not existing_profiles[sid].get("fullName")
    }

    print(f"  Found {len(scholar_ids)} unique Scholar IDs, {len(to_fetch)} need fetching")

    profiles = dict(existing_profiles)

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


# ── Incremental Comparison ──


def compare_with_existing(
    existing_data: Dict,
    current_pubs: List[Dict],
) -> Dict[str, Any]:
    """
    Compare current Scholar page publications with existing data.
    Returns info about what needs updating.
    """
    if not existing_data or "publications" not in existing_data:
        return {
            "is_fresh": True,
            "new_pubs": [p["title"] for p in current_pubs],
            "changed_pubs": [],
            "unchanged_pubs": [],
        }

    existing_map = {}
    for pub in existing_data["publications"]:
        existing_map[pub["title"]] = pub

    new_pubs = []
    changed_pubs = []
    unchanged_pubs = []

    for pub in current_pubs:
        title = pub["title"]
        if title not in existing_map:
            new_pubs.append(title)
        else:
            old = existing_map[title]
            old_cit_count = old.get("citationCount", 0)
            new_cit_count = pub.get("citationCount", 0)
            old_fetched = len(old.get("citations", []))

            # Changed if: citation count increased, or we haven't fetched citations yet
            if new_cit_count > old_cit_count or (new_cit_count > 0 and old_fetched == 0):
                changed_pubs.append(title)
            else:
                unchanged_pubs.append(title)

    return {
        "is_fresh": False,
        "new_pubs": new_pubs,
        "changed_pubs": changed_pubs,
        "unchanged_pubs": unchanged_pubs,
    }


# ── Main Scraping Flow ──


def scrape_scholar(
    scholar_id: str,
    headless: bool = False,
    existing_data: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Full scraping pipeline with incremental update support.
    1. Load profile, get info
    2. Load all publications, compare with existing
    3. For new/changed pubs, scrape citations
    4. Fetch author profiles for new Scholar IDs
    5. Build geo data from profiles
    6. Save everything
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
        print(f"[1/5] Loading profile: {profile_url}")
        driver.get(profile_url)
        time.sleep(PAGE_LOAD_WAIT)

        profile_info = scrape_profile_info(driver)
        researcher_name = profile_info.get("name", "Researcher")
        print(f"  Name: {researcher_name}")
        print(f"  Affiliation: {profile_info.get('affiliation', 'N/A')}")
        print(f"  Total Citations: {profile_info.get('total_citations', 'N/A')}")
        print(f"  H-index: {profile_info.get('h_index', 'N/A')}")
        print(f"  Co-authors: {len(profile_info.get('coauthors', []))}")

        # Step 2: Load all publications and compare
        print(f"\n[2/5] Loading all publications...")
        load_all_publications(driver)
        publications = scrape_publications(driver)
        print(f"  Found {len(publications)} publications on Scholar page")

        comparison = compare_with_existing(existing_data, publications)

        if comparison["is_fresh"]:
            print(f"  → Fresh scrape (no existing data)")
        else:
            print(f"  → {len(comparison['new_pubs'])} new publications")
            print(f"  → {len(comparison['changed_pubs'])} publications with new citations")
            print(f"  → {len(comparison['unchanged_pubs'])} unchanged publications")

        # Step 3: Fetch citations (only for new/changed)
        print(f"\n[3/5] Fetching citations...")
        total_citations = 0
        needs_update = set(comparison["new_pubs"] + comparison["changed_pubs"])

        for i, pub in enumerate(publications):
            if pub["citationCount"] == 0:
                print(f"  [{i+1}/{len(publications)}] {pub['title'][:60]} — 0 citations, skipping")
                continue

            # Use cache for unchanged publications
            if pub["title"] not in needs_update and pub["title"] in cache:
                cached = cache[pub["title"]]
                pub["citations"] = cached.get("citations", [])
                total_citations += len(pub["citations"])
                print(f"  [{i+1}/{len(publications)}] {pub['title'][:60]} — {len(pub['citations'])} cached ✓")
                continue

            # Scrape citations
            print(f"  [{i+1}/{len(publications)}] {pub['title'][:60]} — fetching {pub['citationCount']} citations...")
            citations = scrape_all_citations(driver, pub["citedByUrl"], pub["citationCount"])

            # Fall back to cache if blocked
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

        # Step 4: Fetch Scholar profiles
        existing_profiles = existing_data.get("scholarProfiles", {}) if existing_data else {}
        print(f"\n[4/5] Fetching Scholar profiles for citing authors...")
        scholar_profiles = fetch_all_author_profiles(driver, publications, existing_profiles)

        # Backfill fullAuthors
        for pub in publications:
            for cit in pub.get("citations", []):
                if cit.get("fullAuthors"):
                    continue
                full_names = []
                for author in cit.get("authorList", []):
                    sid = author.get("scholarId", "")
                    if sid and sid in scholar_profiles and scholar_profiles[sid].get("fullName"):
                        full_names.append(scholar_profiles[sid]["fullName"])
                    else:
                        full_names.append(author["name"])
                if full_names:
                    cit["fullAuthors"] = ", ".join(full_names)

        # Step 5: Build geo data from profiles
        print(f"\n[5/5] Building geo data from Scholar profiles...")
        geo_data = build_geo_data(publications, scholar_profiles)
        print(f"  Mapped {len(geo_data)} citations to countries/institutions")

        # Count countries
        countries = set()
        for entry in geo_data.values():
            if entry.get("country"):
                countries.add(entry["country"])
        print(f"  Found {len(countries)} unique countries: {', '.join(sorted(countries))}")

        # Build authorCitations
        author_citations = {}
        for sid, profile in scholar_profiles.items():
            if profile.get("fullName") and profile.get("totalCitations", 0) > 0:
                author_citations[profile["fullName"]] = profile["totalCitations"]

        # Preserve existing themes/summaries
        themes = existing_data.get("themes", {}) if existing_data else {}
        summaries = existing_data.get("summaries", {}) if existing_data else {}

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
            "geoData": geo_data,
            "themes": themes,
            "summaries": summaries,
        }

        return output

    finally:
        driver.quit()
        print("\nBrowser closed.")


# ── LLM Classification ──

THEME_COLORS = [
    "#6366f1",  # indigo
    "#a855f7",  # purple
    "#06b6d4",  # cyan
    "#22c55e",  # green
    "#f59e0b",  # amber
    "#ef4444",  # red
    "#ec4899",  # pink
    "#8b5cf6",  # violet
    "#14b8a6",  # teal
    "#f97316",  # orange
]


def classify_publications_llm(
    publications: List[Dict],
    existing_themes: Dict,
    existing_summaries: Dict,
    llm_key: str,
    llm_provider: str = "openai",
    llm_model: str = "",
) -> tuple:
    """
    Use LLM to classify publications into research themes and generate summaries.
    Only processes publications that don't already have themes/summaries.
    Returns (themes, summaries) dicts keyed by publication title.
    """
    # Find publications needing classification
    titles_needing_themes = []
    for pub in publications:
        if pub["title"] not in existing_themes:
            titles_needing_themes.append(pub["title"])

    titles_needing_summaries = []
    for pub in publications:
        if pub["title"] not in existing_summaries:
            titles_needing_summaries.append(pub["title"])

    if not titles_needing_themes and not titles_needing_summaries:
        print("  All publications already classified, skipping LLM call")
        return existing_themes, existing_summaries

    # Build the prompt with all publication titles
    all_titles = [pub["title"] for pub in publications]
    existing_theme_names = list(set(
        t["theme"] for t in existing_themes.values() if isinstance(t, dict) and "theme" in t
    ))

    prompt = f"""You are a research paper classifier. Given these publication titles, do two things:

1. CLASSIFY each paper into a broad research theme (3-7 themes total).
   {"Use these existing themes where appropriate: " + ", ".join(existing_theme_names) if existing_theme_names else "Create appropriate theme names like: Healthcare, NLP, Computer Vision, Reinforcement Learning, etc."}

2. SUMMARIZE each paper in one sentence (what it likely does/proposes, based on the title).

Publication titles:
{chr(10).join(f"{i+1}. {t}" for i, t in enumerate(all_titles))}

Respond in this exact JSON format (no markdown, no code blocks):
{{
  "themes": {{
    "Paper Title Here": "Theme Name",
    ...
  }},
  "summaries": {{
    "Paper Title Here": "One sentence summary.",
    ...
  }}
}}

IMPORTANT: Include ALL {len(all_titles)} papers. Use the exact paper titles as keys."""

    # Call LLM
    response_text = call_llm(prompt, llm_key, llm_provider, llm_model)
    if not response_text:
        print("  [WARN] LLM returned empty response")
        return existing_themes, existing_summaries

    # Parse response
    try:
        # Strip markdown code blocks if present
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```\s*$", "", cleaned)

        result = json.loads(cleaned)

        # Assign colors to themes
        theme_names = list(set(result.get("themes", {}).values()))
        theme_color_map = {}
        for i, name in enumerate(theme_names):
            theme_color_map[name] = THEME_COLORS[i % len(THEME_COLORS)]

        # Build themes dict
        themes = dict(existing_themes)
        for title, theme_name in result.get("themes", {}).items():
            if title not in themes:
                themes[title] = {
                    "theme": theme_name,
                    "color": theme_color_map.get(theme_name, "#6366f1"),
                }

        # Build summaries dict
        summaries = dict(existing_summaries)
        for title, summary in result.get("summaries", {}).items():
            if title not in summaries:
                summaries[title] = summary

        new_themes = len(themes) - len(existing_themes)
        new_summaries = len(summaries) - len(existing_summaries)
        print(f"  Added {new_themes} new themes, {new_summaries} new summaries")
        print(f"  Theme categories: {', '.join(theme_names)}")

        return themes, summaries

    except json.JSONDecodeError as e:
        print(f"  [WARN] Failed to parse LLM response: {e}")
        print(f"  Response: {response_text[:200]}...")
        return existing_themes, existing_summaries


def call_llm(prompt: str, api_key: str, provider: str = "openai", model: str = "") -> str:
    """Call an LLM API and return the response text."""
    import urllib.request
    import urllib.error

    if provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        model = model or "gpt-4o-mini"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        }).encode()

    elif provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        model = model or "claude-sonnet-4-20250514"
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
        body = json.dumps({
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()

    elif provider == "gemini":
        model = model or "gemini-pro"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
        }).encode()

    else:
        print(f"  [WARN] Unknown LLM provider: {provider}")
        return ""

    try:
        req = urllib.request.Request(url, data=body, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())

        if provider == "openai":
            return data["choices"][0]["message"]["content"]
        elif provider == "claude":
            return data["content"][0]["text"]
        elif provider == "gemini":
            return data["candidates"][0]["content"]["parts"][0]["text"]

    except Exception as e:
        print(f"  [WARN] LLM API call failed: {e}")
        return ""


def main():
    parser = argparse.ArgumentParser(
        description="Scrape Google Scholar profile for Research Network"
    )
    parser.add_argument("scholar_id", help="Google Scholar user ID (e.g., hgN6B6kAAAAJ)")
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output JSON file path (default: data/network.json)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run Chrome in headless mode (no browser window)",
    )
    parser.add_argument(
        "--classify",
        action="store_true",
        help="Classify publications into themes using LLM",
    )
    parser.add_argument(
        "--llm-key",
        default=os.environ.get("LLM_API_KEY", ""),
        help="LLM API key (or set LLM_API_KEY env var)",
    )
    parser.add_argument(
        "--llm-provider",
        default="openai",
        choices=["openai", "claude", "gemini"],
        help="LLM provider (default: openai)",
    )
    parser.add_argument(
        "--llm-model",
        default="",
        help="LLM model override (default: auto-select per provider)",
    )

    args = parser.parse_args()

    # Determine output path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)

    if args.output:
        output_path = args.output
    else:
        output_path = os.path.join(project_dir, "data", "network.json")

    # Load existing data for incremental update
    existing_data = None
    if os.path.exists(output_path):
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
            print(f"Found existing data: {output_path}")
            existing_pubs = len(existing_data.get("publications", []))
            existing_cits = sum(
                len(p.get("citations", []))
                for p in existing_data.get("publications", [])
            )
            print(f"  {existing_pubs} publications, {existing_cits} citing papers")
        except Exception as e:
            print(f"Warning: Could not load existing data: {e}")

    # Scrape
    data = scrape_scholar(
        scholar_id=args.scholar_id,
        headless=args.headless,
        existing_data=existing_data,
    )

    # Optional: Classify publications using LLM
    if args.classify:
        if not args.llm_key:
            print("\n[!] --classify requires an LLM API key.")
            print("    Use --llm-key YOUR_KEY or set LLM_API_KEY environment variable")
        else:
            print(f"\n[LLM] Classifying publications using {args.llm_provider}...")
            themes, summaries = classify_publications_llm(
                data["publications"],
                data.get("themes", {}),
                data.get("summaries", {}),
                args.llm_key,
                args.llm_provider,
                args.llm_model,
            )
            data["themes"] = themes
            data["summaries"] = summaries

    # Save
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    total_cits = sum(len(p.get('citations', [])) for p in data['publications'])
    geo_mapped = len(data.get('geoData', {}))

    print(f"\n{'='*60}")
    print(f"DONE! Output saved to: {output_path}")
    print(f"{'='*60}")
    print(f"  Researcher: {data['researcher']}")
    print(f"  Publications: {len(data['publications'])}")
    print(f"  Total citing papers: {total_cits}")
    print(f"  Geo-mapped citations: {geo_mapped}")
    print(f"  Scholar profiles: {len(data.get('scholarProfiles', {}))}")
    print(f"\nTo update your public site:")
    print(f"  git add data/network.json && git commit -m 'Update research data' && git push")


if __name__ == "__main__":
    main()
