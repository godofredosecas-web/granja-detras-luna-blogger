    'use strict';

    // @EDIT Pega aqui la URL directa de la imagen hero (formato s1600 de Blogger / googleusercontent)
    var HERO_IMAGE_URL = '';

    var GALLERY_BATCH = 5;
    var blogPosts = [];
    var searchQuery = '';
    var lightboxState = { post: null, slides: [], index: 0, isZoomed: false };
    var renderGeneration = 0;
    var searchDebounceTimer = null;

    var BLOGGER_FEED_URL = 'granja_blog.json';
    var ATOM_TEXT_KEY = '$' + 't';
    var MEDIA_THUMB_KEY = 'media' + '$' + 'thumbnail';

    function atomText(obj) {
      if (!obj) return '';
      if (typeof obj === 'string') return obj;
      if (obj[ATOM_TEXT_KEY]) return obj[ATOM_TEXT_KEY];
      if (obj.value) return obj.value;
      return '';
    }

    function applyHeroImage() {
      if (!HERO_IMAGE_URL) return;
      var img = document.getElementById('hero-img');
      var preload = document.getElementById('hero-preload');
      if (img) img.src = HERO_IMAGE_URL;
      if (!preload) {
        preload = document.createElement('link');
        preload.id = 'hero-preload';
        preload.rel = 'preload';
        preload.as = 'image';
        preload.setAttribute('fetchpriority', 'high');
        document.head.appendChild(preload);
      }
      preload.href = HERO_IMAGE_URL;
    }

    function applyHeroFromFeed() {
      if (HERO_IMAGE_URL) return;
      var i, post;
      for (i = 0; i < blogPosts.length; i++) {
        post = blogPosts[i];
        if (post.images && post.images.length) {
          HERO_IMAGE_URL = post.images[0].src;
          break;
        }
      }
      applyHeroImage();
    }

    function getEntryLink(links) {
      if (!links || !links.length) return '';
      var i, alt = null;
      for (i = 0; i < links.length; i++) {
        if (links[i].rel === 'alternate') { alt = links[i]; break; }
      }
      return (alt && alt.href) ? alt.href : (links[0].href || '');
    }

    function slugFromUrl(url) {
      if (!url) return '';
      var parts = url.split('/');
      var last = parts[parts.length - 1] || '';
      return last.replace('.html', '');
    }

    function formatPublished(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch (e) {
        return iso;
      }
    }

    function stripHtml(html) {
      if (!html) return '';
      var doc = new DOMParser().parseFromString(html, 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function upgradeBloggerImageUrl(src) {
      if (!src) return '';
      if (src.indexOf('//') === 0) src = 'https:' + src;
      return src
        .replace(/\/w\d+-h\d+\//, '/s1600/')
        .replace(/\/s\d+-w\d+-h\d+-c\//, '/s1600/')
        .replace(/\/s\d+(-c)?\//, '/s1600/');
    }

    var IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif|svg)(\?|#|$)/i;

    function normalizeContentUrl(src) {
      if (!src) return '';
      src = src.trim();
      if (src.indexOf('//') === 0) src = 'https:' + src;
      return src;
    }

    function isLikelyImageUrl(url) {
      if (!url) return false;
      var u = url.toLowerCase();
      if (IMAGE_EXT_RE.test(u)) return true;
      if (u.indexOf('googleusercontent.com') !== -1) return true;
      if (u.indexOf('blogger.googleusercontent.com') !== -1) return true;
      return false;
    }

    function pushParsedImage(images, seen, src, alt, caption) {
      src = upgradeBloggerImageUrl(normalizeContentUrl(src));
      if (!src || seen[src]) return;
      seen[src] = true;
      images.push({
        src: src,
        alt: (alt || '').trim(),
        caption: (caption || '').trim(),
        description: (caption || '').trim()
      });
    }

    function parseImagesFromContent(html) {
      if (!html) return [];
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var images = [], seen = {}, imgs = doc.querySelectorAll('img'), idx, node, href, text;
      for (idx = 0; idx < imgs.length; idx++) {
        var img = imgs[idx];
        var caption = '';
        var container = img.closest('.tr-caption-container');
        if (!container) container = img.closest('table');
        if (container) {
          var capEl = container.querySelector('.tr-caption');
          if (capEl) caption = (capEl.textContent || '').trim();
        }
        pushParsedImage(images, seen, img.getAttribute('src') || '', img.getAttribute('alt') || '', caption);
      }
      var anchors = doc.querySelectorAll('a[href]');
      for (idx = 0; idx < anchors.length; idx++) {
        node = anchors[idx];
        href = node.getAttribute('href') || '';
        if (!isLikelyImageUrl(href)) continue;
        if (node.querySelector('img')) continue;
        text = (node.textContent || '').trim();
        pushParsedImage(images, seen, href, text, text);
      }
      var urlInText = html.match(/https?:\/\/[^\s<>"']+/gi);
      if (urlInText) {
        for (idx = 0; idx < urlInText.length; idx++) {
          href = urlInText[idx].replace(/[.,;:!?)]+$/, '');
          if (isLikelyImageUrl(href)) pushParsedImage(images, seen, href, '', '');
        }
      }
      return images;
    }

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
      var videos = [], seen = {}, nodes, idx, node, src, title, w, h;
      nodes = doc.querySelectorAll('iframe, video, embed');
      for (idx = 0; idx < nodes.length; idx++) {
        node = nodes[idx];
        src = '';
        title = '';
        w = 0;
        h = 0;
        if (node.tagName === 'VIDEO') {
          src = node.getAttribute('src') || '';
          if (!src) {
            var source = node.querySelector('source');
            if (source) src = source.getAttribute('src') || '';
          }
          title = (node.getAttribute('title') || '').trim();
          w = parseInt(node.getAttribute('width'), 10) || 0;
          h = parseInt(node.getAttribute('height'), 10) || 0;
        } else {
          src = node.getAttribute('src') || node.getAttribute('data-src') || '';
          title = (node.getAttribute('title') || '').trim();
          w = parseInt(node.getAttribute('width'), 10) || 0;
          h = parseInt(node.getAttribute('height'), 10) || 0;
        }
        src = normalizeVideoEmbedUrl(src);
        if (!src || seen[src]) continue;
        seen[src] = true;
        var vtype = 'iframe';
        if (src.indexOf('youtube.com') !== -1) vtype = 'youtube';
        else if (src.indexOf('vimeo.com') !== -1) vtype = 'vimeo';
        else if (src.indexOf('blogger.com/video.g') !== -1) vtype = 'blogger';
        else if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(src)) vtype = 'file';
        videos.push({
          type: vtype,
          embed_url: src,
          title: title,
          width: w > 0 ? w : 640,
          height: h > 0 ? h : 360
        });
      }
      return videos;
    }

    function bloggerVideoEmbedUrl(video) {
      if (!video || !video.embed_url) return '';
      var url = video.embed_url;
      if (url.indexOf('blogger.com/video.g') === -1) return url;
      if (url.indexOf('postUrl=') !== -1) return url;
      if (video.postUrl) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'postUrl=' + encodeURIComponent(video.postUrl);
      }
      return url;
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
      for (i = 0; i < vids.length; i++) {
        slides.push({
          kind: 'video',
          embed_url: vids[i].embed_url,
          type: vids[i].type,
          title: vids[i].title || '',
          caption: vids[i].title || '',
          width: vids[i].width,
          height: vids[i].height,
          postUrl: vids[i].postUrl || (post && post.url) || ''
        });
      }
      for (i = 0; i < imgs.length; i++) {
        slides.push({ kind: 'image', src: imgs[i].src, alt: imgs[i].alt, caption: imgs[i].caption, description: imgs[i].description });
      }
      return slides;
    }

    function getInitialLightboxIndex(post) {
      var imgs = getPostImages(post);
      var vids = getPostVideos(post);
      if (vids.length && !imgs.length) return 0;
      return 0;
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
      var fallback = document.getElementById('lightbox-video-fallback');
      if (fallback) {
        fallback.innerHTML = '';
        fallback.classList.remove('is-visible');
      }
    }

    function updateLightboxVideoFallback(slide) {
      var fallback = document.getElementById('lightbox-video-fallback');
      if (!fallback) return;
      fallback.innerHTML = '';
      fallback.classList.remove('is-visible');
      if (!slide || slide.kind !== 'video') return;
      var openUrl = bloggerVideoEmbedUrl(slide) || slide.embed_url;
      if (slide.postUrl) {
        fallback.innerHTML = 'Si el reproductor no carga, <a href="' + escapeHtml(slide.postUrl) + '" target="_blank" rel="noopener noreferrer" class="text-moon hover:text-moon-light underline underline-offset-2">abre la entrada en Blogger</a> o <a href="' + escapeHtml(openUrl) + '" target="_blank" rel="noopener noreferrer" class="text-moon hover:text-moon-light underline underline-offset-2">reproduce el video en pantalla completa</a>.';
      } else {
        fallback.innerHTML = 'Si el reproductor no carga, <a href="' + escapeHtml(openUrl) + '" target="_blank" rel="noopener noreferrer" class="text-moon hover:text-moon-light underline underline-offset-2">abre el video en una pestana nueva</a>.';
      }
      fallback.classList.add('is-visible');
    }

    function isBloggerHostedVideo(video) {
      var url = (typeof video === 'string') ? video : (video && video.embed_url) || '';
      return url.indexOf('blogger.com/video.g') !== -1;
    }

    function buildVideoIframeHtml(video) {
      var embedUrl = (typeof video === 'string') ? video : (video && video.embed_url) || '';
      if (!embedUrl) return '';
      var width = (video && video.width) ? video.width : 640;
      var height = (video && video.height) ? video.height : 360;
      var isBlogger = isBloggerHostedVideo(video);
      if (typeof video !== 'string' && video && isBlogger) {
        embedUrl = bloggerVideoEmbedUrl(video);
      }
      var html = '<iframe src="' + escapeHtml(embedUrl) + '" title="Video de la bitacora" width="' + width + '" height="' + height + '"';
      html += ' style="width:100%;max-width:100%;height:' + height + 'px;min-height:266px;border:0"';
      html += ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"';
      html += ' allowfullscreen="" webkitallowfullscreen="" mozallowfullscreen=""';
      html += ' referrerpolicy="' + (isBlogger ? 'origin' : 'strict-origin-when-cross-origin') + '" loading="eager"';
      if (isBlogger) {
        html += ' class="b-hbp-video b-uploaded" frameborder="0"';
      }
      html += '></iframe>';
      return html;
    }

    function buildVideoPlayerHtml(video) {
      if (!isBloggerHostedVideo(video)) return buildVideoIframeHtml(video);
      var playUrl = bloggerVideoEmbedUrl(video);
      var postLink = (video && video.postUrl) ? video.postUrl : '';
      var html = '<div class="blogger-video-shell">';
      html += '<div class="blogger-video-actions">';
      html += '<a class="blogger-video-open-btn" href="' + escapeHtml(playUrl) + '" target="_blank" rel="noopener noreferrer">&#9654; Reproducir video</a>';
      if (postLink) {
        html += '<a class="blogger-video-post-link" href="' + escapeHtml(postLink) + '" target="_blank" rel="noopener noreferrer">Ver entrada</a>';
      }
      html += '</div>';
      html += '<p class="blogger-video-hint">Videos subidos a Blogger: si <strong>solo oyes audio y la pantalla es negra</strong> (en Brave/Linux), desactiva aceleraci&oacute;n por hardware en <code>brave://settings/system</code> o abre Brave con <code>--disable-features=AcceleratedVideoDecodeLinuxGL</code>. Vuelve a subir el archivo en H.264 (MP4) o publ&iacute;calo en YouTube y pega el enlace de inserci&oacute;n.</p>';
      html += '<div class="blogger-video-iframe-wrap">' + buildVideoIframeHtml(video) + '</div>';
      html += '</div>';
      return html;
    }

    function thumbnailFromEntry(entry) {
      var thumb = entry[MEDIA_THUMB_KEY];
      if (!thumb) return null;
      var url = thumb.url || (thumb[ATOM_TEXT_KEY] ? thumb[ATOM_TEXT_KEY] : '');
      return url ? upgradeBloggerImageUrl(url) : null;
    }

    function entryToPost(entry) {
      if (!entry) return null;
      var title = atomText(entry.title);
      var content = atomText(entry.content) || atomText(entry.summary);
      var url = getEntryLink(entry.link);
      var labels = [];
      if (entry.category) {
        var cats = entry.category;
        if (!cats.length) cats = [cats];
        var c;
        for (c = 0; c < cats.length; c++) {
          var term = cats[c].term;
          if (term && term.indexOf('schemas.google.com') === -1) labels.push(term);
        }
      }
      var images = parseImagesFromContent(content);
      var videos = parseVideosFromContent(content);
      var vi;
      for (vi = 0; vi < videos.length; vi++) videos[vi].postUrl = url;
      if (!images.length && !videos.length) {
        var thumbSrc = thumbnailFromEntry(entry);
        if (thumbSrc) images.push({ src: thumbSrc, alt: title, caption: '', description: '' });
      }
      return {
        title: title,
        published: formatPublished(atomText(entry.published)),
        url: url,
        slug: slugFromUrl(url),
        labels: labels,
        text: stripHtml(content),
        images: images,
        videos: videos
      };
    }

    function loadBlogPosts() {
      return fetch(BLOGGER_FEED_URL, { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('No se pudo cargar la bitacora (' + res.status + ')');
        return res.json();
      }).then(function (data) {
        blogPosts = Array.isArray(data) ? data : (data.posts || []);
        var i;
        for (i = 0; i < blogPosts.length; i++) {
          if (!blogPosts[i].videos) blogPosts[i].videos = [];
          var v, post = blogPosts[i];
          for (v = 0; v < post.videos.length; v++) {
            if (!post.videos[v].postUrl) post.videos[v].postUrl = post.url || '';
            if (!post.videos[v].width) post.videos[v].width = 640;
            if (!post.videos[v].height) post.videos[v].height = 360;
          }
        }
      });
    }

    function updateBitacoraIntro() {
      var el = document.getElementById('bitacora-intro');
      if (!el || !blogPosts.length) return;
      el.textContent = blogPosts.length + ' registros del rancho ecologico — mamposteria, walipini, biopiscina, lluvias y vida en comunidad — nuestra memoria viva en la tierra.';
    }

    function scheduleIdle(fn, timeout) {
      if (timeout === undefined) timeout = 1200;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(function () { fn(); }, { timeout: timeout });
      } else {
        setTimeout(fn, 1);
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function truncate(text, max) {
      if (!text) return '';
      var t = text.trim();
      if (t.length <= max) return t;
      return t.slice(0, max).trim() + '\u2026';
    }

    function getExcerpt(post) {
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
        return 'Registro del rancho \u00b7 ' + parts.join(', ') + ' en \u00ab' + post.title + '\u00bb.';
      }
      return truncate(post.title, 180);
    }

    function getCoverImage(post) {
      var imgs = post.images || [];
      if (imgs[0] && imgs[0].src) return imgs[0].src;
      var vids = getPostVideos(post);
      if (vids[0]) return getVideoThumbnail(vids[0]);
      return null;
    }

    function getPostImages(post) {
      return (post.images || []).filter(function (i) { return i && i.src; });
    }

    var DEFAULT_IMAGE_ALT = 'Registro fotografico de Granja Detras de la Luna';

    function getImageCaption(img) {
      if (!img) return '';
      var caption = (img.caption || '').trim();
      var description = (img.description || '').trim();
      return caption || description || '';
    }

    function getImageAlt(post, img) {
      if (img && (img.alt || '').trim()) return img.alt.trim();
      if (post && (post.title || '').trim()) return post.title.trim();
      return DEFAULT_IMAGE_ALT;
    }

    function setLightboxZoom(zoomed) {
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
      var fallbackEl = document.getElementById('lightbox-video-fallback');
      var current = slides[index];

      imgEl.classList.add('is-changing');
      function showSlide() {
        clearLightboxVideo();
        if (current.kind === 'video') {
          lightbox.classList.add('is-video-slide');
          videoWrap.innerHTML = buildVideoPlayerHtml(current);
          updateLightboxVideoFallback(current);
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
          if (fallbackEl) {
            fallbackEl.innerHTML = '';
            fallbackEl.classList.remove('is-visible');
          }
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
      if (startIndex === undefined) startIndex = getInitialLightboxIndex(post);
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

    function initLightbox() {
      var imageWrap = document.getElementById('lightbox-image-wrap');

      imageWrap.addEventListener('click', function (e) {
        e.stopPropagation();
        var slide = lightboxState.slides[lightboxState.index];
        if (!slide || slide.kind === 'video') return;
        toggleLightboxZoom();
      });
      imageWrap.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          var slide = lightboxState.slides[lightboxState.index];
          if (!slide || slide.kind === 'video') return;
          toggleLightboxZoom();
        }
      });

      document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
      document.getElementById('lightbox-backdrop').addEventListener('click', function () {
        if (lightboxState.isZoomed) collapseLightboxZoom();
        else closeLightbox();
      });
      document.getElementById('lightbox-prev').addEventListener('click', function (e) {
        e.stopPropagation();
        navigateLightbox(-1);
      });
      document.getElementById('lightbox-next').addEventListener('click', function (e) {
        e.stopPropagation();
        navigateLightbox(1);
      });
      document.getElementById('lightbox-panel').addEventListener('click', function (e) { e.stopPropagation(); });

      document.addEventListener('keydown', function (e) {
        if (!document.getElementById('lightbox').classList.contains('is-open')) return;
        if (e.key === 'Escape') {
          if (lightboxState.isZoomed) collapseLightboxZoom();
          else closeLightbox();
          return;
        }
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      });
    }

    function postMatches(post) {
      var q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      var parts = [post.title, post.text, post.published, post.slug];
      var labels = post.labels || [];
      var i;
      for (i = 0; i < labels.length; i++) parts.push(labels[i]);
      var imgs = post.images || [];
      for (i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        parts.push([im.description, im.caption, im.alt].join(' '));
      }
      var vids = post.videos || [];
      for (i = 0; i < vids.length; i++) {
        parts.push([vids[i].title, vids[i].embed_url, vids[i].type].join(' '));
      }
      return parts.join(' ').toLowerCase().indexOf(q) !== -1;
    }

    function buildLabelsHtml(labels) {
      var slice = (labels || []).slice(0, 3);
      var html = '', i;
      for (i = 0; i < slice.length; i++) {
        if (i > 0) html += '<span class="text-sand/60 mx-1" aria-hidden="true">\u00b7</span>';
        html += '<span class="text-[10px] tracking-wider uppercase text-moon">' + escapeHtml(slice[i]) + '</span>';
      }
      return html;
    }

    function buildGalleryCard(post) {
      var cover = getCoverImage(post);
      var coverImage = (post.images || [])[0];
      var cardAlt = getImageAlt(post, coverImage);
      var excerpt = getExcerpt(post);
      var imageCount = getPostImages(post).length;
      var videoCount = getPostVideos(post).length;
      var mediaCount = getMediaCount(post);
      var hasVideo = videoCount > 0;
      var videoCount = getPostVideos(post).length;
      var mediaCount = getMediaCount(post);
      var hasVideo = videoCount > 0;
      var labelsHtml = buildLabelsHtml(post.labels);

      var card = document.createElement('article');
      card.className = 'gallery-card group rounded-2xl overflow-hidden bg-earth-dark/30 border border-white/5 flex flex-col';
      card.dataset.slug = post.slug;

      var html = '<div class="relative aspect-[4/3] overflow-hidden bg-forest-deep">';
      if (cover) {
        html += '<img src="' + escapeHtml(cover) + '" alt="' + escapeHtml(cardAlt) + '" loading="lazy" decoding="async" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />';
      } else {
        html += '<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-forest-deep to-earth-dark font-display text-moon/60 text-4xl" aria-hidden="true">\u263d</div>';
      }
      html += '<div class="absolute inset-0 bg-card-shine pointer-events-none" aria-hidden="true"></div>';
      if (hasVideo) html += '<div class="media-play-badge" aria-hidden="true"><span>&#9654;</span></div>';
      if (mediaCount > 0) {
        var badge = '';
        if (imageCount > 0) badge += imageCount + ' foto' + (imageCount === 1 ? '' : 's');
        if (videoCount > 0) badge += (badge ? ' · ' : '') + videoCount + ' video' + (videoCount === 1 ? '' : 's');
        html += '<span class="absolute top-4 right-4 px-3 py-1 rounded-full bg-charcoal/70 backdrop-blur-sm text-[10px] tracking-[0.15em] uppercase text-moon-pale border border-moon/20">' + badge + '</span>';
      }
      html += '</div><div class="p-8 lg:p-10 flex flex-col flex-1 gap-4">';
      html += '<time class="text-xs tracking-[0.2em] uppercase text-sand/75" datetime="">' + escapeHtml(post.published || '') + '</time>';
      html += '<h3 class="font-display text-xl lg:text-2xl text-moon-pale leading-snug group-hover:text-moon-light transition-colors">' + escapeHtml(post.title) + '</h3>';
      html += '<p class="text-sand/80 text-sm leading-relaxed flex-1">' + escapeHtml(excerpt) + '</p>';
      if (labelsHtml) html += '<div class="flex flex-wrap items-center gap-1 pt-2">' + labelsHtml + '</div>';
      if (mediaCount > 0) {
        html += '<span class="inline-flex items-center gap-2 text-moon text-sm tracking-wide mt-2 pointer-events-none">Ver galeria <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-4.35-4.35M11 19a7 7 0 11-14 0 7 7 0 0114 0zM10 8v6m3-3H7"/></svg></span>';
      } else {
        html += '<span class="text-sand/70 text-sm mt-2">Sin imagenes en esta entrada</span>';
      }
      html += '</div>';
      card.innerHTML = html;

      if (mediaCount > 0) {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', function () { openLightbox(post, 0); });
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openLightbox(post, 0);
          }
        });
      }

      return card;
    }

    function buildSearchHaystack(post) {
      var parts = [post.title, post.text, post.published, post.slug];
      var labels = post.labels || [];
      var imgs = post.images || [];
      var i;
      for (i = 0; i < labels.length; i++) parts.push(labels[i]);
      for (i = 0; i < imgs.length; i++) {
        parts.push([imgs[i].description, imgs[i].caption, imgs[i].alt].join(' '));
      }
      var vids2 = post.videos || [];
      for (i = 0; i < vids2.length; i++) {
        parts.push([vids2[i].title, vids2[i].embed_url, vids2[i].type].join(' '));
      }
      return parts.join(' ');
    }

    function findPostByUrl(url) {
      if (!url) return null;
      var i, p, norm = url.replace(/\/$/, '');
      for (i = 0; i < blogPosts.length; i++) {
        p = blogPosts[i];
        if (p.url === url || p.url.replace(/\/$/, '') === norm) return p;
      }
      return null;
    }

    function findPostByTitle(title) {
      if (!title) return null;
      var i;
      for (i = 0; i < blogPosts.length; i++) {
        if (blogPosts[i].title === title) return blogPosts[i];
      }
      return null;
    }

    function updateGalleryCount(filtered, total) {
      var countEl = document.getElementById('gallery-count');
      if (!total) total = blogPosts.length;
      if (!total) {
        countEl.textContent = '';
        return;
      }
      countEl.textContent = filtered === total
        ? 'Mostrando las ' + total + ' entradas de la bitacora'
        : 'Mostrando ' + filtered + ' de ' + total + ' entradas';
    }

    function wireServerGallery() {
      var cards = document.querySelectorAll('#gallery-grid .gallery-card');
      var i, card, post, url, title, images;
      for (i = 0; i < cards.length; i++) {
        card = cards[i];
        url = card.getAttribute('data-post-url') || '';
        title = card.getAttribute('data-post-title') || '';
        post = findPostByUrl(url) || findPostByTitle(title);
        if (!post) continue;
        card.setAttribute('data-search', buildSearchHaystack(post));
        if (!getMediaCount(post)) continue;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        (function (p) {
          function openCard() { openLightbox(p, 0); }
          card.addEventListener('click', openCard);
          card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openCard();
            }
          });
        })(post);
      }
    }

    function filterServerGallery() {
      var cards = document.querySelectorAll('#gallery-grid .gallery-card');
      var q = searchQuery.toLowerCase().trim();
      var empty = document.getElementById('gallery-empty');
      var visible = 0;
      var i, card, hay;
      for (i = 0; i < cards.length; i++) {
        card = cards[i];
        hay = (card.getAttribute('data-search') || card.getAttribute('data-post-title') || '').toLowerCase();
        if (!q || hay.indexOf(q) !== -1) {
          card.classList.remove('hidden');
          visible++;
        } else {
          card.classList.add('hidden');
        }
      }
      if (visible === 0 && cards.length) {
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
      }
      updateGalleryCount(visible, cards.length);
    }

    function renderGallery() {
      var gen = ++renderGeneration;
      var grid = document.getElementById('gallery-grid');
      var empty = document.getElementById('gallery-empty');
      var filtered = blogPosts.filter(postMatches);

      grid.innerHTML = '';
      updateGalleryCount(filtered.length, blogPosts.length);

      if (filtered.length === 0) {
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');

      var index = 0;

      function appendBatch() {
        if (gen !== renderGeneration) return;

        var fragment = document.createDocumentFragment();
        var end = Math.min(index + GALLERY_BATCH, filtered.length);
        var i;

        for (i = index; i < end; i++) {
          fragment.appendChild(buildGalleryCard(filtered[i]));
        }
        index = end;
        grid.appendChild(fragment);

        if (index < filtered.length) {
          scheduleIdle(appendBatch, 80);
        }
      }

      scheduleIdle(appendBatch, 80);
    }

    function renderItemPage(post) {
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
        html += '<div class="aspect-video w-full max-w-3xl mx-auto rounded-lg overflow-hidden bg-charcoal">' + buildVideoPlayerHtml(vid) + '</div>';
        if (vid.title) html += '<p class="text-sm text-sand/70 italic text-center">' + escapeHtml(vid.title) + '</p>';
      }
      html += '</div>';
      html += '<p class="mt-12"><a href="' + home + '#bitacora" class="text-moon hover:text-moon-light tracking-wide">&#8592; Volver a la bitacora</a></p>';
      el.innerHTML = html;
    }

    function initItemPage() {
      var el = document.getElementById('item-content');
      if (!el) return;
      el.innerHTML = '<p class="text-sand/75">Cargando entrada\u2026</p>';
      loadBlogPosts().then(function () {
        var path = window.location.pathname.replace(/\/$/, '');
        var i, post;
        for (i = 0; i < blogPosts.length; i++) {
          if (blogPosts[i].url && blogPosts[i].url.replace(/\/$/, '').indexOf(path) !== -1) {
            post = blogPosts[i];
            break;
          }
        }
        if (post) renderItemPage(post);
        else el.innerHTML = '<p class="text-sand/75">No se encontro esta entrada.</p>';
      }).catch(function () {
        el.innerHTML = '<p class="text-sand/75">No se pudo cargar la entrada.</p>';
      });
    }

    function scheduleGalleryLoad() {
      var countEl = document.getElementById('gallery-count');
      var grid = document.getElementById('gallery-grid');
      if (!grid) return;
      countEl.textContent = 'Cargando la bitacora\u2026';

      scheduleIdle(function () {
        loadBlogPosts().then(function () {
          applyHeroFromFeed();
          updateBitacoraIntro();
          renderGallery();
        }).catch(function (err) {
          console.error(err);
          countEl.textContent = '';
          grid.innerHTML = '<p class="col-span-full text-center text-sand/75 py-20">No se pudo cargar la bitacora. Comprueba la conexion o el feed del blog.</p>';
        });
      });
    }

    function initApp() {
      initLightbox();
      applyHeroImage();

      document.getElementById('search-input').addEventListener('input', function (e) {
        searchQuery = e.target.value;
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          if (blogPosts.length) renderGallery();
        }, 150);
      });

      var menuToggle = document.getElementById('menu-toggle');
      var header = document.getElementById('site-header');
      menuToggle.addEventListener('click', function () { header.classList.toggle('nav-open'); });
      var links = document.querySelectorAll('.mobile-link');
      var li;
      for (li = 0; li < links.length; li++) {
        links[li].addEventListener('click', function () { header.classList.remove('nav-open'); });
      }

      window.addEventListener('scroll', function () {
        header.classList.toggle('shadow-2xl', window.scrollY > 40);
      }, { passive: true });

      if (document.getElementById('item-content')) {
        initItemPage();
      } else {
        scheduleGalleryLoad();
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initApp);
    } else {
      initApp();
    }
