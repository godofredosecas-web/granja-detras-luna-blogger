#!/usr/bin/env python3
"""Rebuild granja_blog.json from Atom feed + local images/ folders."""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scrape_granja import (  # noqa: E402
    BLOG_URL,
    DEFAULT_OUTPUT,
    IMAGES_DIR,
    extract_images,
    extract_videos,
    slug_from_post_url,
)
from bs4 import BeautifulSoup

FEED_URL = (
    "https://granjadetrasdelaluna.blogspot.com/feeds/posts/default"
    "?alt=atom&max-results=500"
)
NS = {"atom": "http://www.w3.org/2005/Atom"}


def atom_text(el) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def load_local_images(slug: str) -> list[dict]:
    folder = IMAGES_DIR / slug
    if not folder.is_dir():
        return []
    images = []
    for path in sorted(folder.glob("foto*")):
        if not path.is_file():
            continue
        images.append(
            {
                "src": f"images/{slug}/{path.name}",
                "filename": path.name,
                "alt": "",
                "caption": "",
                "description": "",
            }
        )
    return images


def parse_feed_entry(entry) -> dict | None:
    link = ""
    for child in entry.findall("atom:link", NS):
        if child.attrib.get("rel") == "alternate":
            link = child.attrib.get("href", "")
            break
    if not link:
        return None

    title = atom_text(entry.find("atom:title", NS))
    published = atom_text(entry.find("atom:published", NS)) or atom_text(
        entry.find("atom:updated", NS)
    )
    content_el = entry.find("atom:content", NS)
    content = content_el.text if content_el is not None else ""
    summary_el = entry.find("atom:summary", NS)
    summary = summary_el.text if summary_el is not None else ""
    html = content or summary

    labels = [
        atom_text(cat)
        for cat in entry.findall("atom:category", NS)
        if atom_text(cat) and "schemas.google.com" not in atom_text(cat)
    ]

    soup = BeautifulSoup(html, "html.parser")
    body = soup.body or soup
    slug = slug_from_post_url(link)
    images = extract_images(body, link)
    videos = extract_videos(body, link)
    local_images = load_local_images(slug)

    if local_images:
        for idx, image in enumerate(images):
            if idx < len(local_images):
                image["src"] = local_images[idx]["src"]
                image["filename"] = local_images[idx]["filename"]
        if len(local_images) > len(images):
            images = local_images

    text = body.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return {
        "url": link,
        "slug": slug,
        "title": title,
        "published": published,
        "labels": labels,
        "text": text[:8000] if text else "",
        "images": images,
        "videos": videos,
        "images_dir": f"images/{slug}" if images else None,
    }


def main() -> None:
    xml_text = requests.get(
        FEED_URL,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=60,
    ).text
    root = ET.fromstring(xml_text)
    entries = root.findall("atom:entry", NS)
    posts = [p for p in (parse_feed_entry(e) for e in entries) if p and p["title"]]

    total_images = sum(len(p["images"]) for p in posts)
    total_videos = sum(len(p.get("videos") or []) for p in posts)

    result = {
        "blog": {
            "title": atom_text(root.find("atom:title", NS)),
            "url": BLOG_URL,
            "post_count": len(posts),
            "images_root": "images",
        },
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "posts": posts,
    }

    DEFAULT_OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"Rebuilt {DEFAULT_OUTPUT}: {len(posts)} posts, "
        f"{total_images} images, {total_videos} videos"
    )


if __name__ == "__main__":
    main()
