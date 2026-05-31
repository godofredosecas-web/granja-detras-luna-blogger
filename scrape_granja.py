#!/usr/bin/env python3
"""
Scrapea entradas de granjadetrasdelaluna.blogspot.com:
texto, imágenes (con pies de foto) y descarga local en images/.
"""

from __future__ import annotations

import json
import mimetypes
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

BLOG_URL = "https://granjadetrasdelaluna.blogspot.com/"
FEED_URL = (
    "https://granjadetrasdelaluna.blogspot.com/feeds/posts/default"
    "?alt=rss&max-results=500"
)
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = BASE_DIR / "granja_blog.json"
IMAGES_DIR = BASE_DIR / "images"
REQUEST_DELAY_SEC = 0.5
USER_AGENT = (
    "Mozilla/5.0 (compatible; GranjaBlogScraper/1.0; +https://example.local)"
)


def fetch_html(session: requests.Session, url: str) -> str:
    response = session.get(url, timeout=60)
    response.raise_for_status()
    return response.text


def post_urls_from_feed(session: requests.Session) -> list[dict[str, str]]:
    """Obtiene URL, título y fecha de cada entrada vía feed RSS de Blogger."""
    xml_text = fetch_html(session, FEED_URL)
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    blog_title = (channel.findtext("title") or "").strip() if channel is not None else ""

    posts: list[dict[str, str]] = []
    for item in root.findall(".//item"):
        link = (item.findtext("link") or "").strip()
        if not link or not link.endswith(".html"):
            continue
        posts.append(
            {
                "url": link,
                "title": (item.findtext("title") or "").strip(),
                "published": (item.findtext("pubDate") or "").strip(),
                "blog_title": blog_title,
            }
        )
    return posts


def slug_from_post_url(url: str) -> str:
    """Nombre de carpeta a partir del slug del post (ej. mayo-2026)."""
    path = urlparse(url).path.rstrip("/")
    name = Path(path).stem or "post"
    safe = re.sub(r"[^\w\-]+", "_", name, flags=re.UNICODE).strip("_")
    return safe or "post"


def normalize_image_url(src: str, base_url: str) -> str:
    src = (src or "").strip()
    if not src or src.startswith("data:"):
        return ""
    return urljoin(base_url, src)


def caption_for_image(img: Tag) -> str:
    """Pie de foto desde td.tr-caption dentro de tr-caption-container."""
    container = img.find_parent(class_="tr-caption-container")
    if container is None:
        return ""

    caption_td = container.find("td", class_="tr-caption")
    if caption_td is not None:
        return caption_td.get_text(separator=" ", strip=True)

    for td in reversed(container.find_all("td")):
        text = td.get_text(separator=" ", strip=True)
        if text and td.find("img") is None:
            return text

    return ""


def extension_for_url(url: str, content_type: str | None = None) -> str:
    path = urlparse(url).path
    suffix = Path(unquote(path)).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
        return ".jpg" if suffix == ".jpeg" else suffix

    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext:
            return ".jpg" if ext == ".jpe" else ext

    return ".jpg"


YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:embed/|watch\?v=|v/)|youtu\.be/)([\w-]{11})",
    re.IGNORECASE,
)
VIMEO_ID_RE = re.compile(r"vimeo\.com/(?:video/)?(\d+)", re.IGNORECASE)


def classify_video_url(url: str) -> str:
    lower = url.lower()
    if "youtube.com" in lower or "youtu.be" in lower:
        return "youtube"
    if "vimeo.com" in lower:
        return "vimeo"
    if "blogger.com/video.g" in lower:
        return "blogger"
    if url.lower().endswith((".mp4", ".webm", ".ogg", ".mov")):
        return "file"
    return "iframe"


def normalize_video_embed_url(src: str, base_url: str) -> str:
    src = normalize_image_url(src, base_url)
    if not src:
        return ""

    match = YOUTUBE_ID_RE.search(src)
    if match:
        return f"https://www.youtube.com/embed/{match.group(1)}"

    match = VIMEO_ID_RE.search(src)
    if match:
        return f"https://player.vimeo.com/video/{match.group(1)}"

    return src


def extract_videos(container: Tag, page_url: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    videos: list[dict[str, str]] = []

    def add_video(raw_src: str, title: str = "") -> None:
        embed_url = normalize_video_embed_url(raw_src, page_url)
        if not embed_url or embed_url in seen:
            return
        seen.add(embed_url)
        videos.append(
            {
                "type": classify_video_url(embed_url),
                "embed_url": embed_url,
                "title": title.strip(),
            }
        )

    for iframe in container.find_all("iframe"):
        add_video(iframe.get("src") or iframe.get("data-src") or "")

    for video in container.find_all("video"):
        src = video.get("src") or ""
        if not src:
            source = video.find("source")
            if source:
                src = source.get("src") or ""
        add_video(src, video.get("title") or "")

    for embed in container.find_all("embed"):
        add_video(embed.get("src") or "")

    return videos


IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|gif|webp|bmp|avif|svg)(\?|#|$)", re.IGNORECASE)


def is_likely_image_url(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    if IMAGE_EXT_RE.search(lower):
        return True
    return "googleusercontent.com" in lower


def extract_images(container: Tag, page_url: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    images: list[dict[str, str]] = []

    def add_image(raw_src: str, alt: str = "", caption: str = "") -> None:
        remote_src = normalize_image_url(raw_src, page_url)
        if not remote_src or remote_src in seen:
            return
        seen.add(remote_src)
        description = caption or alt
        images.append(
            {
                "src_remote": remote_src,
                "alt": alt.strip(),
                "description": description,
                "caption": caption.strip(),
            }
        )

    for img in container.find_all("img"):
        caption = caption_for_image(img)
        alt = (img.get("alt") or "").strip()
        add_image(img.get("src") or img.get("data-src") or "", alt, caption)

    for anchor in container.find_all("a", href=True):
        if anchor.find("img"):
            continue
        href = anchor.get("href") or ""
        if not is_likely_image_url(href):
            continue
        text = anchor.get_text(strip=True)
        add_image(href, text, text)

    return images


def download_post_images(
    session: requests.Session,
    post_slug: str,
    images: list[dict[str, str]],
) -> None:
    post_dir = IMAGES_DIR / post_slug
    post_dir.mkdir(parents=True, exist_ok=True)

    for index, image in enumerate(images, start=1):
        remote_url = image.pop("src_remote", "")
        if not remote_url:
            continue

        response = session.get(remote_url, timeout=120, stream=True)
        response.raise_for_status()

        ext = extension_for_url(remote_url, response.headers.get("Content-Type"))
        filename = f"foto{index}{ext}"
        local_path = post_dir / filename
        rel_src = f"images/{post_slug}/{filename}"

        with local_path.open("wb") as f:
            for chunk in response.iter_content(chunk_size=65536):
                if chunk:
                    f.write(chunk)

        image["src"] = rel_src
        image["filename"] = filename


def extract_text(container: Tag) -> str:
    """Texto visible del cuerpo del post, sin scripts ni estilos."""
    clone = BeautifulSoup(str(container), "html.parser")
    for tag in clone.find_all(["script", "style", "noscript"]):
        tag.decompose()

    blocks: list[str] = []
    for element in clone.find_all(
        ["p", "h1", "h2", "h3", "h4", "li", "blockquote", "td"]
    ):
        if element.name == "td" and not element.find_parent(
            class_="tr-caption-container"
        ):
            continue
        line = element.get_text(separator=" ", strip=True)
        if line:
            blocks.append(line)

    if blocks:
        return "\n\n".join(blocks)

    return clone.get_text(separator="\n", strip=True)


def scrape_post(
    session: requests.Session,
    meta: dict[str, str],
    download_images: bool = True,
) -> dict:
    html = fetch_html(session, meta["url"])
    soup = BeautifulSoup(html, "html.parser")

    title = meta["title"]
    title_el = soup.select_one(".post-title, h3.post-title")
    if title_el:
        title = title_el.get_text(strip=True) or title

    date_el = soup.select_one(".published, .post-timestamp, time")
    published = meta["published"]
    if date_el:
        published = (
            date_el.get("datetime")
            or date_el.get_text(strip=True)
            or published
        )

    body = (
        soup.select_one(".post-body")
        or soup.select_one(".post-body.entry-content")
        or soup.select_one("[itemprop='articleBody']")
        or soup.select_one(".entry-content")
        or soup.select_one("#item-content")
        or soup.select_one(".post-content")
    )
    if body is None:
        article = soup.select_one("article")
        body = article if article else soup

    text = extract_text(body) if isinstance(body, Tag) else ""
    images = extract_images(body, meta["url"]) if isinstance(body, Tag) else []
    videos = extract_videos(body, meta["url"]) if isinstance(body, Tag) else []

    post_slug = slug_from_post_url(meta["url"])
    if download_images and images:
        download_post_images(session, post_slug, images)

    labels = [
        a.get_text(strip=True)
        for a in soup.select(".post-labels a, .labels a")
        if a.get_text(strip=True)
    ]

    return {
        "url": meta["url"],
        "slug": post_slug,
        "title": title,
        "published": published,
        "labels": labels,
        "text": text,
        "images": images,
        "videos": videos,
        "images_dir": f"images/{post_slug}" if images else None,
    }


def scrape_blog(
    output_path: Path = DEFAULT_OUTPUT,
    delay_sec: float = REQUEST_DELAY_SEC,
    download_images: bool = True,
) -> dict:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    if download_images:
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    feed_posts = post_urls_from_feed(session)
    if not feed_posts:
        raise RuntimeError("No se encontraron entradas en el feed RSS.")

    blog_title = feed_posts[0].get("blog_title", "")
    scraped_posts: list[dict] = []

    for index, meta in enumerate(feed_posts, start=1):
        print(f"[{index}/{len(feed_posts)}] {meta['url']}", file=sys.stderr)
        scraped_posts.append(
            scrape_post(session, meta, download_images=download_images)
        )
        if index < len(feed_posts) and delay_sec > 0:
            time.sleep(delay_sec)

    result = {
        "blog": {
            "title": blog_title,
            "url": BLOG_URL,
            "post_count": len(scraped_posts),
            "images_root": "images",
        },
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "posts": scraped_posts,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return result


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    data = scrape_blog(output)
    total_images = sum(len(p["images"]) for p in data["posts"])
    total_videos = sum(len(p.get("videos") or []) for p in data["posts"])
    print(
        f"Guardado: {output} ({data['blog']['post_count']} entradas, "
        f"{total_images} imágenes, {total_videos} vídeos en {IMAGES_DIR})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
