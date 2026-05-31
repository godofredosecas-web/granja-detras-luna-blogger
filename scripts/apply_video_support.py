#!/usr/bin/env python3
"""Patch blogger-theme.xml, index.html critical CSS, and sync app.js video helpers."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THEME = ROOT / "blogger-theme.xml"
APP = ROOT / "app.js"
INDEX = ROOT / "index.html"

VIDEO_JS = r'''
    var YOUTUBE_ID_RE = /(?:youtube\.com\/(?:embed\/|watch\?v=|v\/)|youtu\.be\/)([\w-]{11})/i;
    var VIMEO_ID_RE = /vimeo\.com\/(?:video\/)?(\d+)/i;

    function normalizeVideoEmbedUrl(src) {
      if (!src) return '';
      if (src.indexOf('//') === 0) src = 'https:' + src;
      var m = src.match(YOUTUBE_ID_RE);
      if (m) return 'https://www.youtube.com/embed/' + m[1];
      m = src.match(VIMEO_ID_RE);
      if (m) return 'https://player.vimeo.com/video/' + m[1];
      return src;
    }

    function parseVideosFromContent(html) {
      if (!html) return [];
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var videos = [], seen = {}, nodes, idx, node, src, title;
      nodes = doc.querySelectorAll('iframe, video, embed');
      for (idx = 0; idx < nodes.length; idx++) {
        node = nodes[idx];
        src = '';
        title = '';
        if (node.tagName === 'VIDEO') {
          src = node.getAttribute('src') || '';
          if (!src) {
            var source = node.querySelector('source');
            if (source) src = source.getAttribute('src') || '';
          }
          title = (node.getAttribute('title') || '').trim();
        } else {
          src = node.getAttribute('src') || node.getAttribute('data-src') || '';
        }
        src = normalizeVideoEmbedUrl(src);
        if (!src || seen[src]) continue;
        seen[src] = true;
        var vtype = 'iframe';
        if (src.indexOf('youtube.com') !== -1) vtype = 'youtube';
        else if (src.indexOf('vimeo.com') !== -1) vtype = 'vimeo';
        else if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(src)) vtype = 'file';
        videos.push({ type: vtype, embed_url: src, title: title });
      }
      return videos;
    }

    function getYouTubeThumb(embedUrl) {
      var m = embedUrl.match(YOUTUBE_ID_RE);
      return m ? 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' : '';
    }

    function getVideoThumbnail(video) {
      if (!video || !video.embed_url) return '';
      if (video.type === 'youtube') return getYouTubeThumb(video.embed_url);
      return '';
    }

    function getPostVideos(post) {
      return (post && post.videos) ? post.videos.filter(function (v) { return v && v.embed_url; }) : [];
    }

    function getPostSlides(post) {
      var slides = [], imgs = getPostImages(post), vids = getPostVideos(post), i;
      for (i = 0; i < imgs.length; i++) {
        slides.push({ kind: 'image', src: imgs[i].src, alt: imgs[i].alt, caption: imgs[i].caption, description: imgs[i].description });
      }
      for (i = 0; i < vids.length; i++) {
        slides.push({ kind: 'video', embed_url: vids[i].embed_url, type: vids[i].type, title: vids[i].title || '', caption: vids[i].title || '' });
      }
      return slides;
    }

    function getMediaCount(post) {
      return getPostImages(post).length + getPostVideos(post).length;
    }

    function getSlideCaption(slide) {
      if (!slide) return '';
      if (slide.kind === 'video') return (slide.caption || slide.title || '').trim();
      return getImageCaption(slide);
    }

    function clearLightboxVideo() {
      var wrap = document.getElementById('lightbox-video-wrap');
      if (wrap) wrap.innerHTML = '';
    }

    function buildVideoIframeHtml(embedUrl) {
      return '<iframe src="' + escapeHtml(embedUrl) + '" title="Video de la bitacora" class="w-full h-full rounded-lg" style="width:100%;height:100%;min-height:240px;border:0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>';
    }
'''

VIDEO_CSS = """
        #lightbox-video-wrap { display: none; width: 100%; max-width: 100%; aspect-ratio: 16/9; max-height: 58vh; }
        #lightbox.is-video-slide #lightbox-img { display: none !important; }
        #lightbox.is-video-slide #lightbox-video-wrap { display: block !important; }
        #lightbox.is-video-slide #lightbox-image-wrap { cursor: default; }
        #lightbox.is-video-slide #lightbox-zoom-hint { display: none !important; }
        #lightbox.is-video-slide.is-image-zoomed #lightbox-image-wrap { position: relative; inset: auto; padding: 0; }
        .gallery-card .media-play-badge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
        .gallery-card .media-play-badge span { width: 3.5rem; height: 3.5rem; border-radius: 9999px; background: rgba(20,18,16,0.72); border: 1px solid rgba(201,169,98,0.35); display: flex; align-items: center; justify-content: center; color: #F5E6C8; font-size: 1.25rem; }
"""

LIGHTBOX_VIDEO_HTML = """          <div id="lightbox-video-wrap" class="hidden w-full max-h-[58vh] rounded-lg overflow-hidden bg-charcoal"></div>
"""


def patch_theme(text: str) -> str:
    if "parseVideosFromContent" not in text:
        text = text.replace(
            "        .gallery-card:focus-visible { outline: 2px solid rgba(201, 169, 98, 0.6); outline-offset: 4px; }",
            "        .gallery-card:focus-visible { outline: 2px solid rgba(201, 169, 98, 0.6); outline-offset: 4px; }"
            + VIDEO_CSS,
        )
        text = text.replace(
            '<img id="lightbox-img" src="" alt="" class="max-w-full max-h-[58vh]',
            LIGHTBOX_VIDEO_HTML + '\n          <img id="lightbox-img" src="" alt="" class="max-w-full max-h-[58vh]',
        )
        text = text.replace(
            "var lightboxState = { post: null, images: [], index: 0, isZoomed: false };",
            "var lightboxState = { post: null, slides: [], index: 0, isZoomed: false };",
        )
        text = text.replace(
            "      return images;\n    }\n\n    function thumbnailFromEntry(entry) {",
            "      return images;\n    }\n" + VIDEO_JS + "\n    function thumbnailFromEntry(entry) {",
        )
        text = text.replace(
            "        text: stripHtml(content),\n        images: images\n      };",
            "        text: stripHtml(content),\n        images: images,\n        videos: parseVideosFromContent(content)\n      };",
        )

    # getExcerpt
    old_excerpt = """    function getExcerpt(post) {
      if (post.text && post.text.trim()) return truncate(post.text.trim(), 180);
      var imgs = post.images || [];
      var i, img;
      for (i = 0; i < imgs.length; i++) {
        img = imgs[i];
        if ((img.description && img.description.trim()) || (img.caption && img.caption.trim())) {
          return truncate((img.description || img.caption).trim(), 180);
        }
      }
      var n = imgs.length;
      if (n > 0) {
        return 'Registro fotografico del rancho \\u00b7 ' + n + ' imagenes en \\u00ab' + post.title + '\\u00bb.';
      }
      return truncate(post.title, 180);
    }

    function getCoverImage(post) {
      var imgs = post.images || [];
      return imgs[0] && imgs[0].src ? imgs[0].src : null;
    }"""

    new_excerpt = """    function getExcerpt(post) {
      if (post.text && post.text.trim()) return truncate(post.text.trim(), 180);
      var imgs = post.images || [];
      var i, img;
      for (i = 0; i < imgs.length; i++) {
        img = imgs[i];
        if ((img.description && img.description.trim()) || (img.caption && img.caption.trim())) {
          return truncate((img.description || img.caption).trim(), 180);
        }
      }
      var ni = imgs.length;
      var nv = getPostVideos(post).length;
      if (ni > 0 || nv > 0) {
        var parts = [];
        if (ni > 0) parts.push(ni + ' foto' + (ni === 1 ? '' : 's'));
        if (nv > 0) parts.push(nv + ' video' + (nv === 1 ? '' : 's'));
        return 'Registro del rancho \\u00b7 ' + parts.join(', ') + ' en \\u00ab' + post.title + '\\u00bb.';
      }
      return truncate(post.title, 180);
    }

    function getCoverImage(post) {
      var imgs = post.images || [];
      if (imgs[0] && imgs[0].src) return imgs[0].src;
      var vids = getPostVideos(post);
      if (vids[0]) return getVideoThumbnail(vids[0]);
      return null;
    }"""

    if old_excerpt in text:
        text = text.replace(old_excerpt, new_excerpt)

    # Lightbox block - replace updateLightboxSlide through navigateLightbox
    if "function updateLightboxSlide()" in text and "lightboxState.slides" not in text:
        start = text.index("    function setLightboxZoom(zoomed) {")
        end = text.index("    function initLightbox() {")
        new_lb = r'''    function setLightboxZoom(zoomed) {
      var slide = lightboxState.slides[lightboxState.index];
      if (!slide || slide.kind === 'video') return;
      lightboxState.isZoomed = zoomed;
      var lightbox = document.getElementById('lightbox');
      var wrap = document.getElementById('lightbox-image-wrap');
      lightbox.classList.toggle('is-image-zoomed', zoomed);
      wrap.setAttribute('aria-label', zoomed
        ? 'Reducir imagen al tamano del carrusel'
        : 'Expandir imagen a pantalla completa');
      document.getElementById('lightbox-img').setAttribute('aria-expanded', String(zoomed));
    }

    function collapseLightboxZoom() {
      if (lightboxState.isZoomed) setLightboxZoom(false);
    }

    function toggleLightboxZoom() {
      var slide = lightboxState.slides[lightboxState.index];
      if (!slide || slide.kind === 'video') return;
      setLightboxZoom(!lightboxState.isZoomed);
    }

    function updateLightboxSlide() {
      collapseLightboxZoom();
      var slides = lightboxState.slides;
      var index = lightboxState.index;
      var post = lightboxState.post;
      if (!slides.length) return;

      var lightbox = document.getElementById('lightbox');
      var imgEl = document.getElementById('lightbox-img');
      var videoWrap = document.getElementById('lightbox-video-wrap');
      var captionEl = document.getElementById('lightbox-caption');
      var counterEl = document.getElementById('lightbox-counter');
      var prevBtn = document.getElementById('lightbox-prev');
      var nextBtn = document.getElementById('lightbox-next');
      var current = slides[index];

      imgEl.classList.add('is-changing');
      function showSlide() {
        clearLightboxVideo();
        if (current.kind === 'video') {
          lightbox.classList.add('is-video-slide');
          videoWrap.innerHTML = buildVideoIframeHtml(current.embed_url);
          imgEl.removeAttribute('src');
          imgEl.alt = post.title || 'Video';
          captionEl.textContent = getSlideCaption(current) || 'Video de la bitacora';
          captionEl.classList.toggle('text-sand/60', !getSlideCaption(current));
          captionEl.classList.toggle('italic', !!getSlideCaption(current));
          counterEl.textContent = slides.length > 1
            ? 'Video ' + (index + 1) + ' de ' + slides.length
            : '1 video en esta entrada';
        } else {
          lightbox.classList.remove('is-video-slide');
          imgEl.src = current.src;
          imgEl.alt = getImageAlt(post, current);
          imgEl.loading = 'eager';
          imgEl.decoding = 'async';
          var caption = getSlideCaption(current);
          captionEl.textContent = caption;
          captionEl.classList.toggle('text-sand/60', !caption);
          captionEl.classList.toggle('italic', !!caption);
          if (!caption) captionEl.textContent = 'Sin pie de foto para esta imagen.';
          counterEl.textContent = slides.length > 1
            ? 'Imagen ' + (index + 1) + ' de ' + slides.length
            : '1 imagen en esta entrada';
        }
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= slides.length - 1;
        imgEl.classList.remove('is-changing');
      }

      requestAnimationFrame(function () {
        requestAnimationFrame(showSlide);
      });
    }

    function openLightbox(post, startIndex) {
      if (startIndex === undefined) startIndex = 0;
      var slides = getPostSlides(post);
      if (!slides.length) return;

      lightboxState = {
        post: post,
        slides: slides,
        index: Math.max(0, Math.min(startIndex, slides.length - 1)),
        isZoomed: false
      };
      document.getElementById('lightbox').classList.remove('is-image-zoomed', 'is-video-slide');

      document.getElementById('lightbox-title').textContent = post.title;
      document.getElementById('lightbox-date').textContent = post.published || '';
      document.getElementById('lightbox').classList.add('is-open');
      document.getElementById('lightbox').setAttribute('aria-hidden', 'false');
      document.body.classList.add('lightbox-open');
      updateLightboxSlide();
    }

    function closeLightbox() {
      collapseLightboxZoom();
      clearLightboxVideo();
      document.getElementById('lightbox').classList.remove('is-open', 'is-image-zoomed', 'is-video-slide');
      document.getElementById('lightbox').setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lightbox-open');
      document.getElementById('lightbox-img').src = '';
      lightboxState = { post: null, slides: [], index: 0, isZoomed: false };
    }

    function navigateLightbox(delta) {
      collapseLightboxZoom();
      var slides = lightboxState.slides;
      var index = lightboxState.index;
      if (!slides.length) return;
      var next = index + delta;
      if (next < 0 || next >= slides.length) return;
      lightboxState.index = next;
      updateLightboxSlide();
    }

'''
        text = text[:start] + new_lb + text[end:]

    # buildGalleryCard media count
    text = text.replace(
        "      var imageCount = getPostImages(post).length;",
        "      var imageCount = getPostImages(post).length;\n      var videoCount = getPostVideos(post).length;\n      var mediaCount = getMediaCount(post);\n      var hasVideo = videoCount > 0;",
    )
    text = text.replace(
        "      html += '<div class=\"absolute inset-0 bg-card-shine pointer-events-none\" aria-hidden=\"true\"></div>';\n      if (imageCount > 0) {",
        "      html += '<div class=\"absolute inset-0 bg-card-shine pointer-events-none\" aria-hidden=\"true\"></div>';\n      if (hasVideo) html += '<div class=\"media-play-badge\" aria-hidden=\"true\"><span>&#9654;</span></div>';\n      if (mediaCount > 0) {",
    )
    text = text.replace(
        "        html += '<span class=\"absolute top-4 right-4 px-3 py-1 rounded-full bg-charcoal/70 backdrop-blur-sm text-[10px] tracking-[0.15em] uppercase text-moon-pale border border-moon/20\">' + imageCount + ' foto' + (imageCount === 1 ? '' : 's') + '</span>';",
        "        var badge = '';\n        if (imageCount > 0) badge += imageCount + ' foto' + (imageCount === 1 ? '' : 's');\n        if (videoCount > 0) badge += (badge ? ' · ' : '') + videoCount + ' video' + (videoCount === 1 ? '' : 's');\n        html += '<span class=\"absolute top-4 right-4 px-3 py-1 rounded-full bg-charcoal/70 backdrop-blur-sm text-[10px] tracking-[0.15em] uppercase text-moon-pale border border-moon/20\">' + badge + '</span>';",
    )
    text = text.replace(
        "      if (imageCount > 0) {\n        html += '<span class=\"inline-flex items-center gap-2 text-moon text-sm tracking-wide mt-2 pointer-events-none\">Ver galeria",
        "      if (mediaCount > 0) {\n        html += '<span class=\"inline-flex items-center gap-2 text-moon text-sm tracking-wide mt-2 pointer-events-none\">Ver galeria",
    )
    text = text.replace(
        "      if (imageCount > 0) {\n        card.setAttribute('role', 'button');",
        "      if (mediaCount > 0) {\n        card.setAttribute('role', 'button');",
    )

    # postMatches + buildSearchHaystack
    text = text.replace(
        "      for (i = 0; i < imgs.length; i++) {\n        var im = imgs[i];\n        parts.push([im.description, im.caption, im.alt].join(' '));\n      }\n      return parts.join(' ').toLowerCase().indexOf(q) !== -1;",
        "      for (i = 0; i < imgs.length; i++) {\n        var im = imgs[i];\n        parts.push([im.description, im.caption, im.alt].join(' '));\n      }\n      var vids = post.videos || [];\n      for (i = 0; i < vids.length; i++) {\n        parts.push([vids[i].title, vids[i].embed_url, vids[i].type].join(' '));\n      }\n      return parts.join(' ').toLowerCase().indexOf(q) !== -1;",
    )
    text = text.replace(
        "      for (i = 0; i < imgs.length; i++) {\n        parts.push([imgs[i].description, imgs[i].caption, imgs[i].alt].join(' '));\n      }\n      return parts.join(' ');",
        "      for (i = 0; i < imgs.length; i++) {\n        parts.push([imgs[i].description, imgs[i].caption, imgs[i].alt].join(' '));\n      }\n      var vids2 = post.videos || [];\n      for (i = 0; i < vids2.length; i++) {\n        parts.push([vids2[i].title, vids2[i].embed_url, vids2[i].type].join(' '));\n      }\n      return parts.join(' ');",
    )
    text = text.replace(
        "        images = getPostImages(post);\n        if (!images.length) continue;",
        "        if (!getMediaCount(post)) continue;",
    )

    # renderItemPage
    old_item = """    function renderItemPage(post) {
      var el = document.getElementById('item-content');
      if (!el || !post) return;
      var home = window.location.protocol + '//' + window.location.host + '/';
      el.innerHTML =
        '<time class="text-xs tracking-[0.2em] uppercase text-sand/75 block mb-4">' + escapeHtml(post.published || '') + '</time>' +
        '<h1 class="font-display text-3xl sm:text-4xl text-moon-pale mb-8 leading-tight">' + escapeHtml(post.title) + '</h1>' +
        '<div class="post-body text-sand/85 text-lg leading-relaxed">' + (post.text ? '<p>' + escapeHtml(post.text) + '</p>' : '') + '</div>' +
        '<p class="mt-12"><a href="' + home + '#bitacora" class="text-moon hover:text-moon-light tracking-wide">&#8592; Volver a la bitacora</a></p>';
    }"""

    new_item = """    function renderItemPage(post) {
      var el = document.getElementById('item-content');
      if (!el || !post) return;
      var home = window.location.protocol + '//' + window.location.host + '/';
      var html = '';
      var i, im, vid;
      html += '<time class="text-xs tracking-[0.2em] uppercase text-sand/75 block mb-4">' + escapeHtml(post.published || '') + '</time>';
      html += '<h1 class="font-display text-3xl sm:text-4xl text-moon-pale mb-8 leading-tight">' + escapeHtml(post.title) + '</h1>';
      html += '<div class="post-body text-sand/85 text-lg leading-relaxed space-y-8">';
      if (post.text) html += '<p>' + escapeHtml(post.text) + '</p>';
      for (i = 0; i < (post.images || []).length; i++) {
        im = post.images[i];
        if (!im.src) continue;
        html += '<figure class="space-y-2"><img src="' + escapeHtml(im.src) + '" alt="' + escapeHtml(im.alt || post.title) + '" class="w-full rounded-lg" loading="lazy" decoding="async" />';
        if (im.caption) html += '<figcaption class="text-sm text-sand/70 italic">' + escapeHtml(im.caption) + '</figcaption>';
        html += '</figure>';
      }
      for (i = 0; i < getPostVideos(post).length; i++) {
        vid = getPostVideos(post)[i];
        html += '<div class="aspect-video w-full max-w-3xl mx-auto rounded-lg overflow-hidden bg-charcoal">' + buildVideoIframeHtml(vid.embed_url) + '</div>';
        if (vid.title) html += '<p class="text-sm text-sand/70 italic text-center">' + escapeHtml(vid.title) + '</p>';
      }
      html += '</div>';
      html += '<p class="mt-12"><a href="' + home + '#bitacora" class="text-moon hover:text-moon-light tracking-wide">&#8592; Volver a la bitacora</a></p>';
      el.innerHTML = html;
    }"""

    if old_item in text:
        text = text.replace(old_item, new_item)

    text = text.replace(
        "      imageWrap.addEventListener('click', function (e) {\n        e.stopPropagation();\n        toggleLightboxZoom();\n      });",
        "      imageWrap.addEventListener('click', function (e) {\n        e.stopPropagation();\n        var slide = lightboxState.slides[lightboxState.index];\n        if (!slide || slide.kind === 'video') return;\n        toggleLightboxZoom();\n      });",
    )
    text = text.replace(
        "      imageWrap.addEventListener('keydown', function (e) {\n        if (e.key === 'Enter' || e.key === ' ') {\n          e.preventDefault();\n          e.stopPropagation();\n          toggleLightboxZoom();\n        }\n      });",
        "      imageWrap.addEventListener('keydown', function (e) {\n        if (e.key === 'Enter' || e.key === ' ') {\n          e.preventDefault();\n          e.stopPropagation();\n          var slide = lightboxState.slides[lightboxState.index];\n          if (!slide || slide.kind === 'video') return;\n          toggleLightboxZoom();\n        }\n      });",
    )

    return text


def main():
    theme = THEME.read_text(encoding="utf-8")
    theme = patch_theme(theme)
    THEME.write_text(theme, encoding="utf-8")
    print("Patched", THEME)


if __name__ == "__main__":
    main()
