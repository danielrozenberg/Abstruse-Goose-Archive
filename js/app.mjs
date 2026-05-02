// Base path: the directory containing this app (e.g. '/Abstruse-Goose-Archive/' or '/')
const BASE = new URL('..', import.meta.url).pathname;

const state = {
  comics: [],
  currentIndex: 0,
  fuse: null,
};

// ── Transcript helpers ────────────────────────────────────────────────────────

function transcriptSearchableText(comic) {
  const t = comic.transcript;
  if (!t) return '';
  if (typeof t === 'string') return t;
  return [t.text, t.visualNote].filter(Boolean).join('\n');
}

// ── URL routing ───────────────────────────────────────────────────────────────

function getRoute() {
  const path = window.location.pathname;
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return path.slice(base.length) || '/';
}

function routeUrl(route) {
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return base + route;
}

function navigate(route, push = true) {
  const url = routeUrl(route);
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
  handleRoute();
}

function handleRoute() {
  const route = getRoute();
  const numMatch = route.match(/^\/(\d+)$/);
  if (numMatch) {
    const idx = state.comics.findIndex(c => c.number === parseInt(numMatch[1], 10));
    showComicView(idx >= 0 ? idx : 0);
  } else if (route === '/index') {
    showIndexView();
  } else {
    // Default: last viewed or first
    const saved = localStorage.getItem('lastViewed');
    if (saved) {
      const idx = state.comics.findIndex(c => c.number === parseInt(saved, 10));
      if (idx >= 0) { showComicView(idx); return; }
    }
    showComicView(0);
  }
}

// Intercept internal link clicks for SPA navigation
document.addEventListener('click', e => {
  const link = e.target.closest('a[href]');
  if (!link || link.target === '_blank') return;
  let url;
  try { url = new URL(link.href); } catch { return; }
  if (url.origin !== location.origin) return;
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const route = url.pathname.slice(base.length) || '/';
  if (!/^(\/|\/index|\/\d+)$/.test(route)) return;
  e.preventDefault();
  navigate(route);
});

window.addEventListener('popstate', handleRoute);

// ── Progress bar ──────────────────────────────────────────────────────────────

let progressTimerId = null;
let progressStepId = null;

function startProgressBar() {
  const container = document.getElementById('progress-container');
  const bar = document.getElementById('progress-bar');
  container.hidden = false;
  bar.style.width = '0%';
  let width = 0;
  progressStepId = setInterval(() => {
    width += (88 - width) * 0.07;
    bar.style.width = `${width}%`;
  }, 150);
}

function finishProgressBar() {
  clearTimeout(progressTimerId);
  clearInterval(progressStepId);
  const container = document.getElementById('progress-container');
  const bar = document.getElementById('progress-bar');
  if (!container.hidden) {
    bar.style.width = '100%';
    setTimeout(() => { container.hidden = true; bar.style.width = '0%'; }, 300);
  } else {
    container.hidden = true;
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function loadData() {
  progressTimerId = setTimeout(startProgressBar, 800);
  try {
    const response = await fetch('data/comics.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.comics = data.comics;
  } finally {
    finishProgressBar();
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

function initSearch() {
  // Build a flat searchable version with the transcript text field extracted
  const searchable = state.comics.map(c => ({
    ...c,
    _transcriptText: transcriptSearchableText(c),
  }));

  state.fuse = new Fuse(searchable, {
    keys: [
      { name: 'title', weight: 3.0 },
      { name: 'comment', weight: 1.0 },
      { name: '_transcriptText', weight: 1.5 },
    ],
    threshold: 0.35,
    minMatchCharLength: 2,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text, indices) {
  if (!indices?.length) return escapeHtml(text);
  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  let result = '';
  let pos = 0;
  for (const [s, e] of sorted) {
    if (s >= pos) {
      result += escapeHtml(text.slice(pos, s));
      result += `<strong>${escapeHtml(text.slice(s, e + 1))}</strong>`;
      pos = e + 1;
    }
  }
  return result + escapeHtml(text.slice(pos));
}

function buildExcerpt(text, indices, context = 60) {
  if (!text) return '';
  if (!indices?.length) return escapeHtml(text.slice(0, 130)) + (text.length > 130 ? '…' : '');
  const [s, e] = indices[0];
  const start = Math.max(0, s - context);
  const end = Math.min(text.length, e + context + 1);
  const windowIndices = indices
    .filter(([is, ie]) => is >= start && ie < end)
    .map(([is, ie]) => [is - start, ie - start]);
  return (
    (start > 0 ? '…' : '') +
    highlight(text.slice(start, end), windowIndices) +
    (end < text.length ? '…' : '')
  );
}

function buildSearchResultHtml(fuseResult) {
  const { item, matches, _isNumber } = fuseResult;
  const num = item.number;

  if (_isNumber) {
    return `<div class="search-result" data-number="${num}" role="option" tabindex="0">
      <span class="result-number">#${num}</span>
      <span class="result-title">${escapeHtml(item.title)}</span>
    </div>`;
  }

  const titleMatch = matches?.find(m => m.key === 'title');
  const textMatch = matches?.find(m => m.key !== 'title');

  if (titleMatch && !textMatch) {
    return `<div class="search-result" data-number="${num}" role="option" tabindex="0">
      <span class="result-number">#${num}</span>
      <span class="result-title">${highlight(item.title, titleMatch.indices)}</span>
    </div>`;
  }

  // Text/transcript match — show excerpt
  const sourceText = textMatch?.key === 'comment'
    ? item.comment
    : item._transcriptText;
  return `<div class="search-result search-result--text" data-number="${num}" role="option" tabindex="0">
    <div class="result-header">
      <span class="result-number">#${num}</span>
      <span class="result-title">${escapeHtml(item.title)}</span>
    </div>
    <div class="result-excerpt">${buildExcerpt(sourceText, textMatch?.indices)}</div>
  </div>`;
}

function runSearch(query) {
  // Number search
  const numQ = query.replace(/^#/, '');
  if (/^\d+$/.test(numQ)) {
    const matches = state.comics.filter(c => String(c.number).startsWith(numQ));
    if (matches.length) {
      return matches.slice(0, 10).map(c => ({ item: { ...c, _transcriptText: '' }, matches: null, _isNumber: true }));
    }
  }
  return state.fuse.search(query, { limit: 10 });
}

function closeSearch() {
  const resultsEl = document.getElementById('search-results');
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  document.getElementById('search-input').setAttribute('aria-expanded', 'false');
}

function handleSearch(query) {
  const resultsEl = document.getElementById('search-results');
  const inputEl = document.getElementById('search-input');

  if (query.length < 2) { closeSearch(); return; }

  const results = runSearch(query);
  if (!results.length) {
    resultsEl.innerHTML = '<div class="search-empty">No results found</div>';
    resultsEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
    return;
  }

  resultsEl.innerHTML = results.map(buildSearchResultHtml).join('');
  resultsEl.hidden = false;
  inputEl.setAttribute('aria-expanded', 'true');
}

// ── Image loading with spinner ────────────────────────────────────────────────

let imageSpinnerTimer = null;

function setImage(comic) {
  const img = document.getElementById('comic-image');
  const spinner = document.getElementById('comic-spinner');
  const missing = document.getElementById('comic-missing');

  if (!comic.imageExists) {
    clearTimeout(imageSpinnerTimer);
    img.hidden = true;
    spinner.hidden = true;
    missing.hidden = false;
    return;
  }

  missing.hidden = true;
  const newSrc = `comics/${comic.image}`;

  // No change needed if same image is already displayed
  if (!img.hidden && img.getAttribute('data-src') === newSrc) return;

  img.hidden = true;
  spinner.hidden = true;
  clearTimeout(imageSpinnerTimer);

  const onDone = () => {
    clearTimeout(imageSpinnerTimer);
    img.removeEventListener('load', onDone);
    img.removeEventListener('error', onDone);
    spinner.hidden = true;
    img.hidden = false;
  };

  img.addEventListener('load', onDone);
  img.addEventListener('error', onDone);

  img.src = newSrc;
  img.setAttribute('data-src', newSrc);
  img.alt = `Comic #${comic.number}: ${comic.title}`;
  img.title = comic.image;

  imageSpinnerTimer = setTimeout(() => {
    if (img.hidden) spinner.hidden = false;
  }, 200);

  // Already cached
  if (img.complete && img.naturalWidth > 0) onDone();
}

// ── Views ─────────────────────────────────────────────────────────────────────

function showComicView(idx) {
  document.getElementById('view-comic').hidden = false;
  document.getElementById('view-index').hidden = true;
  renderComic(idx);
}

function showIndexView() {
  document.getElementById('view-comic').hidden = true;
  document.getElementById('view-index').hidden = false;
  renderIndex();
}

function renderComic(idx) {
  if (idx < 0 || idx >= state.comics.length) return;
  state.currentIndex = idx;
  const comic = state.comics[idx];

  localStorage.setItem('lastViewed', String(comic.number));
  document.title = `#${comic.number} – ${comic.title} | Abstruse Goose`;

  document.getElementById('comic-number').textContent = `#${comic.number}`;
  document.getElementById('comic-title').textContent = comic.title;

  setImage(comic);

  // Comment
  const commentEl = document.getElementById('comic-comment');
  if (comic.commentHtml) {
    commentEl.innerHTML = comic.commentHtml;
    commentEl.hidden = false;
  } else {
    commentEl.innerHTML = '';
    commentEl.hidden = true;
  }

  // Transcript panel — reset to hidden on navigation
  document.getElementById('transcript-panel').hidden = true;
  document.getElementById('btn-transcript').textContent = 'Show transcript';
  renderTranscript(comic);

  // Prev/Next links
  const prevLink = document.getElementById('btn-prev');
  const nextLink = document.getElementById('btn-next');
  if (idx > 0) {
    prevLink.href = routeUrl('/' + state.comics[idx - 1].number);
    prevLink.removeAttribute('aria-disabled');
  } else {
    prevLink.removeAttribute('href');
    prevLink.setAttribute('aria-disabled', 'true');
  }
  if (idx < state.comics.length - 1) {
    nextLink.href = routeUrl('/' + state.comics[idx + 1].number);
    nextLink.removeAttribute('aria-disabled');
  } else {
    nextLink.removeAttribute('href');
    nextLink.setAttribute('aria-disabled', 'true');
  }

  document.getElementById('comic-display').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderTranscript(comic) {
  const content = document.getElementById('transcript-content');
  const t = comic.transcript;

  if (!t || (typeof t === 'string' && !t) ||
      (typeof t === 'object' && !t.text && !t.scene && !t.visualNote)) {
    content.innerHTML = '<p class="transcript-empty">No transcript available for this comic.</p>';
    return;
  }

  if (typeof t === 'string') {
    content.innerHTML = `<section class="transcript-section">
      <p>${escapeHtml(t).replace(/\n/g, '<br>')}</p>
    </section>`;
    return;
  }

  let html = '';
  if (t.scene) {
    html += `<section class="transcript-section">
      <h3>Scene</h3>
      <p>${escapeHtml(t.scene)}</p>
    </section>`;
  }
  if (t.text) {
    html += `<section class="transcript-section">
      <h3>Transcript</h3>
      <p>${escapeHtml(t.text).replace(/\n/g, '<br>')}</p>
    </section>`;
  }
  if (t.visualNote) {
    html += `<section class="transcript-section">
      <h3>Visual note</h3>
      <p>${escapeHtml(t.visualNote)}</p>
    </section>`;
  }
  content.innerHTML = html || '<p class="transcript-empty">No transcript available.</p>';
}

function renderIndex() {
  const list = document.getElementById('index-list');
  if (list.dataset.rendered) return;
  list.dataset.rendered = '1';
  document.getElementById('index-count').textContent = `(${state.comics.length})`;
  list.innerHTML = state.comics.map(c =>
    `<a class="index-item" href="${routeUrl('/' + c.number)}">
      <span class="index-number">#${c.number}</span>
      <span class="index-title">${escapeHtml(c.title)}</span>
    </a>`,
  ).join('');
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function handleKeydown(e) {
  const searchFocused = document.activeElement === document.getElementById('search-input');

  if (searchFocused) {
    if (e.key === 'Escape') { closeSearch(); document.getElementById('search-input').blur(); }
    return;
  }

  // Don't override browser shortcuts
  if (e.altKey || e.metaKey) return;

  switch (e.key) {
    case 'ArrowLeft':
      if (state.currentIndex > 0) navigate('/' + state.comics[state.currentIndex - 1].number);
      break;
    case 'ArrowRight':
      if (state.currentIndex < state.comics.length - 1) navigate('/' + state.comics[state.currentIndex + 1].number);
      break;
    case '/':
      e.preventDefault();
      document.getElementById('search-input').focus();
      document.getElementById('search-input').select();
      break;
    case 'r':
    case 'R':
      if (e.ctrlKey) return; // let browser refresh
      navigate('/' + state.comics[Math.floor(Math.random() * state.comics.length)].number);
      break;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const overlay = document.getElementById('loading-overlay');

  try {
    await loadData();
    initSearch();
    handleRoute();
    overlay.hidden = true;
  } catch (err) {
    overlay.textContent = 'Failed to load archive. Please try refreshing.';
    console.error(err);
    return;
  }

  // Random button
  document.getElementById('btn-random').addEventListener('click', () => {
    navigate('/' + state.comics[Math.floor(Math.random() * state.comics.length)].number);
  });

  // Transcript toggle
  document.getElementById('btn-transcript').addEventListener('click', () => {
    const panel = document.getElementById('transcript-panel');
    const btn = document.getElementById('btn-transcript');
    panel.hidden = !panel.hidden;
    btn.textContent = panel.hidden ? 'Show transcript' : 'Hide transcript';
  });

  // Search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', e => handleSearch(e.target.value.trim()));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearch(); searchInput.blur(); }
  });

  const resultsEl = document.getElementById('search-results');
  function activateResult(el) {
    if (!el) return;
    const idx = state.comics.findIndex(c => c.number === parseInt(el.dataset.number, 10));
    if (idx >= 0) {
      showComicView(idx);
      navigate('/' + state.comics[idx].number);
      searchInput.value = '';
      closeSearch();
      searchInput.blur();
    }
  }
  resultsEl.addEventListener('click', e => activateResult(e.target.closest('[data-number]')));
  resultsEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activateResult(e.target.closest('[data-number]'));
    }
  });

  // Close search on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('search-container').contains(e.target)) closeSearch();
  });

  document.addEventListener('keydown', handleKeydown);
});
