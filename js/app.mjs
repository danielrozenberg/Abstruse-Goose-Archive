// Base path: the directory containing this app (e.g. '/Abstruse-Goose-Archive/' or '/')
const BASE = new URL('..', import.meta.url).pathname;

const state = {
  comics: [],
  searchable: [],  // comics augmented with _transcriptText
  currentIndex: 0,
  fuse: null,      // Fuse instance for title + comment fuzzy search only
};

let activeTab = null;    // null = closed, 1/2/3 = active tab number
let searchFocusIdx = -1; // keyboard-focused result index (-1 = none)

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
  if (route === '/' || route === '') {
    showIndexView();
  } else if (route === '/index') {
    showIndexView();
  } else if (/^\/\d+$/.test(route)) {
    const num = parseInt(route.slice(1), 10);
    const idx = state.comics.findIndex(c => c.number === num);
    if (idx >= 0) showComicView(idx);
    else show404View();
  } else {
    show404View();
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
  state.searchable = state.comics.map(c => ({
    ...c,
    _transcriptText: transcriptSearchableText(c),
  }));

  // Fuse.js only for short-text fields where fuzzy matching is appropriate.
  // Transcript text uses exact substring matching (see runSearch) to avoid
  // Fuse matching scattered individual characters across long strings.
  state.fuse = new Fuse(state.searchable, {
    keys: [
      { name: 'title', weight: 3.0 },
      { name: 'comment', weight: 1.0 },
    ],
    threshold: 0.35,
    minMatchCharLength: 2,
    includeScore: true,
    includeMatches: true,
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
    return `<div class="search-result" data-number="${num}" role="option" tabindex="-1">
      <span class="result-number">#${num}</span>
      <span class="result-title">${escapeHtml(item.title)}</span>
    </div>`;
  }

  const titleMatch = matches?.find(m => m.key === 'title');
  const textMatch = matches?.find(m => m.key !== 'title');

  if (titleMatch && !textMatch) {
    return `<div class="search-result" data-number="${num}" role="option" tabindex="-1">
      <span class="result-number">#${num}</span>
      <span class="result-title">${highlight(item.title, titleMatch.indices)}</span>
    </div>`;
  }

  const sourceText = textMatch?.key === 'comment' ? item.comment : item._transcriptText;
  return `<div class="search-result search-result--text" data-number="${num}" role="option" tabindex="-1">
    <div class="result-header">
      <span class="result-number">#${num}</span>
      <span class="result-title">${escapeHtml(item.title)}</span>
    </div>
    <div class="result-excerpt">${buildExcerpt(sourceText, textMatch?.indices)}</div>
  </div>`;
}

function runSearch(query) {
  const numQ = query.replace(/^#/, '');
  if (/^\d+$/.test(numQ)) {
    const hits = state.comics.filter(c => String(c.number).startsWith(numQ));
    if (hits.length) return hits.slice(0, 20).map(c => ({ item: { ...c, _transcriptText: '' }, matches: null, _isNumber: true }));
  }

  const titleResults = state.fuse.search(query, { limit: 20 });
  const titleNumbers = new Set(titleResults.map(r => r.item.number));

  const lower = query.toLowerCase();
  const textResults = state.searchable
    .filter(c => !titleNumbers.has(c.number) && c._transcriptText.toLowerCase().includes(lower))
    .slice(0, Math.max(0, 20 - titleResults.length))
    .map(c => {
      const idx = c._transcriptText.toLowerCase().indexOf(lower);
      return {
        item: c,
        matches: [{ key: '_transcriptText', value: c._transcriptText, indices: [[idx, idx + query.length - 1]] }],
        _isNumber: false,
      };
    });

  return [...titleResults, ...textResults];
}

function updateSearchFocus() {
  const els = document.querySelectorAll('#search-results [data-number]');
  els.forEach((el, i) => {
    el.classList.toggle('search-result--focused', i === searchFocusIdx);
    if (i === searchFocusIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

function closeSearch() {
  searchFocusIdx = -1;
  const resultsEl = document.getElementById('search-results');
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  document.getElementById('search-input').setAttribute('aria-expanded', 'false');
}

function handleSearch(query) {
  searchFocusIdx = -1;
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

  if (img.complete && img.naturalWidth > 0) onDone();
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '';
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
  return s.split(/\n{2,}/).map(block => {
    const hMatch = block.match(/^(#{1,4}) ([\s\S]+)/);
    if (hMatch) {
      const level = Math.min(hMatch[1].length + 2, 6);
      return `<h${level}>${hMatch[2]}</h${level}>`;
    }
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function updateTabButtons() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = parseInt(btn.dataset.tab, 10) === activeTab;
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.classList.toggle('tab-btn--active', active);
  });
}

function renderTabContent(comic) {
  const inner = document.getElementById('tab-panel-inner');
  const t = comic.transcript;

  switch (activeTab) {
    case 1:
      inner.innerHTML = comic.commentHtml
        ? `<div class="tab-comment">${comic.commentHtml}</div>`
        : '<p class="tab-empty">No comment for this comic.</p>';
      break;
    case 2: {
      const text = !t ? '' : typeof t === 'string' ? t : (t.text ?? '');
      inner.innerHTML = text ? renderMarkdown(text) : '<p class="tab-empty">No transcript available.</p>';
      break;
    }
    case 3: {
      if (!t || typeof t === 'string' || (!t.scene && !t.visualNote)) {
        inner.innerHTML = '<p class="tab-empty">No visual description available.</p>';
      } else {
        let html = '';
        if (t.scene) html += `<section class="transcript-section"><h3>Scene</h3>${renderMarkdown(t.scene)}</section>`;
        if (t.visualNote) html += `<section class="transcript-section"><h3>Visual note</h3>${renderMarkdown(t.visualNote)}</section>`;
        inner.innerHTML = html;
      }
      break;
    }
  }
}

function toggleTab(n) {
  const panel = document.getElementById('tab-panel');
  const comic = state.comics[state.currentIndex];

  if (activeTab === n) {
    // Close: pin current height, then slide to 0
    panel.style.height = panel.offsetHeight + 'px';
    panel.offsetHeight; // force reflow
    activeTab = null;
    updateTabButtons();
    panel.style.height = '0';
    return;
  }

  const from = panel.offsetHeight; // 0 if closed, current px if switching
  activeTab = n;
  updateTabButtons();
  if (comic) renderTabContent(comic);

  // Measure target height without visual flash:
  // temporarily disable transition, snap to auto, read height, snap back to 'from'
  panel.style.transition = 'none';
  panel.style.height = 'auto';
  const to = panel.offsetHeight;
  panel.style.height = from + 'px';
  panel.offsetHeight; // force reflow so the 'from' height is applied before re-enabling

  panel.style.transition = '';
  panel.style.height = to + 'px';

  // After animation, restore 'auto' so navigating to different comics
  // adjusts the panel height naturally without needing explicit updates
  panel.addEventListener('transitionend', () => {
    if (activeTab !== null) panel.style.height = 'auto';
  }, { once: true });
}

// ── Views ─────────────────────────────────────────────────────────────────────

function showComicView(idx) {
  document.getElementById('view-comic').hidden = false;
  document.getElementById('view-index').hidden = true;
  document.getElementById('view-404').hidden = true;
  renderComic(idx);
}

function showIndexView() {
  document.getElementById('view-comic').hidden = true;
  document.getElementById('view-index').hidden = false;
  document.getElementById('view-404').hidden = true;
  document.title = 'All Comics | Abstruse Goose Archive';
  renderIndex();
}

function show404View() {
  document.getElementById('view-comic').hidden = true;
  document.getElementById('view-index').hidden = true;
  document.getElementById('view-404').hidden = false;
  document.title = 'Not found | Abstruse Goose Archive';
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

  // Re-render whichever tab is currently open for the new comic
  if (activeTab !== null) renderTabContent(comic);
  updateTabButtons();

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
    // Arrow nav and Enter are handled by the search input's own listener
    if (e.key === 'Escape') { closeSearch(); document.getElementById('search-input').blur(); }
    return;
  }

  // Let the native dialog handle its own Escape
  if (document.getElementById('shortcuts-dialog').open) return;

  if (e.altKey || e.metaKey) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'a': case 'A':
    case 'j': case 'J':
      if (state.currentIndex > 0) navigate('/' + state.comics[state.currentIndex - 1].number);
      break;
    case 'ArrowRight':
    case 'd': case 'D':
    case 'k': case 'K':
      if (state.currentIndex < state.comics.length - 1) navigate('/' + state.comics[state.currentIndex + 1].number);
      break;
    case 'h': case 'H':
    case 'i': case 'I':
      navigate('/index');
      break;
    case '/':
      e.preventDefault();
      document.getElementById('search-input').focus();
      document.getElementById('search-input').select();
      break;
    case 'r': case 'R':
      if (e.ctrlKey) return;
      navigate('/' + state.comics[Math.floor(Math.random() * state.comics.length)].number);
      break;
    case '1': case '2': case '3':
      if (!document.getElementById('view-comic').hidden) toggleTab(parseInt(e.key, 10));
      break;
    case '?':
      document.getElementById('shortcuts-dialog').showModal();
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

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleTab(parseInt(btn.dataset.tab, 10)));
  });

  // Search placeholder: hide keyboard hint on mobile
  const searchInput = document.getElementById('search-input');
  const mobileQuery = window.matchMedia('(max-width: 600px)');
  const updatePlaceholder = () => {
    searchInput.placeholder = mobileQuery.matches ? 'Search…' : 'Search… (/ to focus)';
  };
  mobileQuery.addEventListener('change', updatePlaceholder);
  updatePlaceholder();
  searchInput.addEventListener('input', e => handleSearch(e.target.value.trim()));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearch(); searchInput.blur(); return; }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const els = document.querySelectorAll('#search-results [data-number]');
      if (els.length) { searchFocusIdx = Math.min(searchFocusIdx + 1, els.length - 1); updateSearchFocus(); }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchFocusIdx = Math.max(searchFocusIdx - 1, -1);
      updateSearchFocus();
      return;
    }
    if (e.key === 'Enter' && searchFocusIdx >= 0) {
      e.preventDefault();
      const el = document.querySelectorAll('#search-results [data-number]')[searchFocusIdx];
      if (el) activateResult(el);
      return;
    }
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

  document.addEventListener('click', e => {
    if (!document.getElementById('search-container').contains(e.target)) closeSearch();
  });

  document.addEventListener('keydown', handleKeydown);

  // Shortcuts dialog
  const dialog = document.getElementById('shortcuts-dialog');
  document.getElementById('btn-close-shortcuts').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
});
