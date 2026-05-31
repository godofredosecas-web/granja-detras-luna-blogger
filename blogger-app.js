'use strict';

// @EDIT Pega aqui la URL directa de la imagen hero (formato s1600 de Blogger / googleusercontent)
var HERO_IMAGE_URL = '';

var GALLERY_BATCH = 5;
var blogPosts = [];
var searchQuery = '';
var lightboxState = { post: null, images: [], index: 0, isZoomed: false };
var renderGeneration = 0;
var searchDebounceTimer = null;

var BLOGGER_FEED_URL = window.location.protocol + '//' + window.location.host + '/feeds/posts/default?alt=json&max-results=150';
var ATOM_TEXT_KEY = '$' + 't';
var MEDIA_THUMB_KEY = 'media' + '$' + 'thumbnail';

function atomText(obj) {
  return obj && obj[ATOM_TEXT_KEY] ? obj[ATOM_TEXT_KEY] : '';
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

function parseImagesFromContent(html) {
  if (!html) return [];
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var images = [], seen = {}, imgs = doc.querySelectorAll('img'), idx;
  for (idx = 0; idx < imgs.length; idx++) {
    var img = imgs[idx];
    var src = upgradeBloggerImageUrl(img.getAttribute('src') || '');
    if (!src || seen[src]) continue;
    seen[src] = true;
    var alt = (img.getAttribute('alt') || '').trim();
    var caption = '';
    var container = img.closest('.tr-caption-container');
    if (!container) container = img.closest('table');
    if (container) {
      var capEl = container.querySelector('.tr-caption');
      if (capEl) caption = (capEl.textContent || '').trim();
    }
    images.push({ src: src, alt: alt, caption: caption, description: caption });
  }
  return images;
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
  if (!images.length) {
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
    images: images
  };
}

function loadBlogPosts() {
  return fetch(BLOGGER_FEED_URL).then(function (res) {
    if (!res.ok) throw new Error('No se pudo cargar la bitacora (' + res.status + ')');
    return res.json();
  }).then(function (data) {
    var entries = (data.feed && data.feed.entry) ? data.feed.entry : [];
    if (entries && !entries.length && entries[ATOM_TEXT_KEY] === undefined && !entries.map) entries = [entries];
    blogPosts = entries.map(entryToPost).filter(function (p) { return p && p.title; });
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
  var n = imgs.length;
  if (n > 0) {
    return 'Registro fotografico del rancho \u00b7 ' + n + ' imagenes en \u00ab' + post.title + '\u00bb.';
  }
  return truncate(post.title, 180);
}

function getCoverImage(post) {
  var imgs = post.images || [];
  return imgs[0] && imgs[0].src ? imgs[0].src : null;
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
  setLightboxZoom(!lightboxState.isZoomed);
}

function updateLightboxSlide() {
  collapseLightboxZoom();
  var images = lightboxState.images;
  var index = lightboxState.index;
  var post = lightboxState.post;
  if (!images.length) return;

  var imgEl = document.getElementById('lightbox-img');
  var captionEl = document.getElementById('lightbox-caption');
  var counterEl = document.getElementById('lightbox-counter');
  var prevBtn = document.getElementById('lightbox-prev');
  var nextBtn = document.getElementById('lightbox-next');
  var current = images[index];

  imgEl.classList.add('is-changing');
  function showSlide() {
    imgEl.src = current.src;
    imgEl.alt = getImageAlt(post, current);
    imgEl.loading = 'eager';
    imgEl.decoding = 'async';
    var caption = getImageCaption(current);
    captionEl.textContent = caption;
    captionEl.classList.toggle('text-sand/60', !caption);
    captionEl.classList.toggle('italic', !!caption);
    if (!caption) captionEl.textContent = 'Sin pie de foto para esta imagen.';
    counterEl.textContent = images.length > 1
      ? 'Imagen ' + (index + 1) + ' de ' + images.length
      : '1 imagen en esta entrada';
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= images.length - 1;
    imgEl.classList.remove('is-changing');
  }

  requestAnimationFrame(function () {
    requestAnimationFrame(showSlide);
  });
}

function openLightbox(post, startIndex) {
  if (startIndex === undefined) startIndex = 0;
  var images = getPostImages(post);
  if (!images.length) return;

  lightboxState = {
    post: post,
    images: images,
    index: Math.max(0, Math.min(startIndex, images.length - 1)),
    isZoomed: false
  };
  document.getElementById('lightbox').classList.remove('is-image-zoomed');

  document.getElementById('lightbox-title').textContent = post.title;
  document.getElementById('lightbox-date').textContent = post.published || '';
  document.getElementById('lightbox').classList.add('is-open');
  document.getElementById('lightbox').setAttribute('aria-hidden', 'false');
  document.body.classList.add('lightbox-open');
  updateLightboxSlide();
}

function closeLightbox() {
  collapseLightboxZoom();
  document.getElementById('lightbox').classList.remove('is-open', 'is-image-zoomed');
  document.getElementById('lightbox').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('lightbox-open');
  document.getElementById('lightbox-img').src = '';
  lightboxState = { post: null, images: [], index: 0, isZoomed: false };
}

function navigateLightbox(delta) {
  collapseLightboxZoom();
  var images = lightboxState.images;
  var index = lightboxState.index;
  if (!images.length) return;
  var next = index + delta;
  if (next < 0 || next >= images.length) return;
  lightboxState.index = next;
  updateLightboxSlide();
}

function initLightbox() {
  var imageWrap = document.getElementById('lightbox-image-wrap');

  imageWrap.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleLightboxZoom();
  });
  imageWrap.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
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
  if (imageCount > 0) {
    html += '<span class="absolute top-4 right-4 px-3 py-1 rounded-full bg-charcoal/70 backdrop-blur-sm text-[10px] tracking-[0.15em] uppercase text-moon-pale border border-moon/20">' + imageCount + ' foto' + (imageCount === 1 ? '' : 's') + '</span>';
  }
  html += '</div><div class="p-8 lg:p-10 flex flex-col flex-1 gap-4">';
  html += '<time class="text-xs tracking-[0.2em] uppercase text-sand/75" datetime="">' + escapeHtml(post.published || '') + '</time>';
  html += '<h3 class="font-display text-xl lg:text-2xl text-moon-pale leading-snug group-hover:text-moon-light transition-colors">' + escapeHtml(post.title) + '</h3>';
  html += '<p class="text-sand/80 text-sm leading-relaxed flex-1">' + escapeHtml(excerpt) + '</p>';
  if (labelsHtml) html += '<div class="flex flex-wrap items-center gap-1 pt-2">' + labelsHtml + '</div>';
  if (imageCount > 0) {
    html += '<span class="inline-flex items-center gap-2 text-moon text-sm tracking-wide mt-2 pointer-events-none">Ver galeria <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-4.35-4.35M11 19a7 7 0 11-14 0 7 7 0 0114 0zM10 8v6m3-3H7"/></svg></span>';
  } else {
    html += '<span class="text-sand/70 text-sm mt-2">Sin imagenes en esta entrada</span>';
  }
  html += '</div>';
  card.innerHTML = html;

  if (imageCount > 0) {
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

function updateGalleryCount(filtered) {
  var countEl = document.getElementById('gallery-count');
  if (!blogPosts.length) {
    countEl.textContent = '';
    return;
  }
  countEl.textContent = filtered.length === blogPosts.length
    ? 'Mostrando las ' + blogPosts.length + ' entradas de la bitacora'
    : 'Mostrando ' + filtered.length + ' de ' + blogPosts.length + ' entradas';
}

function renderGallery() {
  var gen = ++renderGeneration;
  var grid = document.getElementById('gallery-grid');
  var empty = document.getElementById('gallery-empty');
  var filtered = blogPosts.filter(postMatches);

  grid.innerHTML = '';
  updateGalleryCount(filtered);

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

function scheduleGalleryLoad() {
  var countEl = document.getElementById('gallery-count');
  countEl.textContent = 'Cargando la bitacora\u2026';

  scheduleIdle(function () {
    var grid = document.getElementById('gallery-grid');
    loadBlogPosts().then(function () {
      applyHeroFromFeed();
      updateBitacoraIntro();
      renderGallery();
    }).catch(function (err) {
      console.error(err);
      countEl.textContent = '';
      grid.innerHTML = '<p class="text-center text-sand/75 py-20">No se pudo cargar la bitacora. Comprueba la conexion o el feed del blog.</p>';
    });
  });
}

function initApp() {
  initLightbox();

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

  scheduleGalleryLoad();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
