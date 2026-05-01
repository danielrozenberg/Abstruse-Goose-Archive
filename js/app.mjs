const state = {
  comics: [],
  currentIndex: 0,
  fuse: null,
};

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  const response = await fetch('data/comics.json');
  if (!response.ok) throw new Error(`Failed to load comics.json: ${response.status}`);
  const data = await response.json();
  state.comics = data.comics;
}

// ── Search ────────────────────────────────────────────────────────────────────

function initSearch() {
  state.fuse = new Fuse(state.comics, {
    keys: [
      { name: 'title', weight: 2.0 },
      { name: 'comment', weight: 1.0 },
      { name: 'transcript', weight: 0.8 },
    ],
    threshold: 0.35,
    minMatchCharLength: 2,
    includeScore: true,
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function closeSearch() {
  const resultsEl = document.getElementById('search-results');
  const inputEl = document.getElementById('search-input');
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  inputEl.setAttribute('aria-expanded', 'false');
}

function handleSearch(query) {
  const resultsEl = document.getElementById('search-results');
  const inputEl = document.getElementById('search-input');

  if (query.length < 2) {
    closeSearch();
    return;
  }

  const results = state.fuse.search(query, { limit: 10 });

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="search-empty">No results found</div>';
    resultsEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
    return;
  }

  resultsEl.innerHTML = results
    .map(({ item }) => `
      <div class="search-result" data-number="${item.number}" role="option" tabindex="0">
        <span class="result-number">#${item.number}</span>
        <span class="result-title">${escapeHtml(item.title)}</span>
      </div>
    `)
    .join('');
  resultsEl.hidden = false;
  inputEl.setAttribute('aria-expanded', 'true');
}

function navigateToSearchResult(number) {
  const idx = state.comics.findIndex(c => c.number === number);
  if (idx >= 0) {
    renderComic(idx);
    document.getElementById('search-input').value = '';
    closeSearch();
    document.getElementById('search-input').blur();
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

function getInitialIndex() {
  const hash = window.location.hash.slice(1);
  const num = parseInt(hash, 10);
  if (!isNaN(num)) {
    const idx = state.comics.findIndex(c => c.number === num);
    if (idx >= 0) return idx;
  }
  const saved = localStorage.getItem('lastViewed');
  if (saved) {
    const idx = state.comics.findIndex(c => c.number === parseInt(saved, 10));
    if (idx >= 0) return idx;
  }
  return 0;
}

function setHash(comicNumber) {
  history.pushState(null, '', `#${comicNumber}`);
  localStorage.setItem('lastViewed', String(comicNumber));
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderComic(index) {
  if (index < 0 || index >= state.comics.length) return;
  state.currentIndex = index;
  const comic = state.comics[index];

  // URL and persistence
  history.pushState(null, '', `#${comic.number}`);
  localStorage.setItem('lastViewed', String(comic.number));

  // Header info
  document.getElementById('comic-number').textContent = `#${comic.number}`;
  document.getElementById('comic-title').textContent = comic.title;
  document.title = `#${comic.number} – ${comic.title} | Abstruse Goose`;

  // Image or missing placeholder
  const img = document.getElementById('comic-image');
  const missing = document.getElementById('comic-missing');
  if (comic.imageExists) {
    img.src = `comics/${comic.image}`;
    img.alt = `Comic #${comic.number}: ${comic.title}`;
    img.hidden = false;
    missing.hidden = true;
  } else {
    img.src = '';
    img.hidden = true;
    missing.hidden = false;
  }

  // Comment (author-supplied HTML from the archive — no user input involved)
  const commentEl = document.getElementById('comic-comment');
  if (comic.commentHtml) {
    commentEl.innerHTML = comic.commentHtml;
    commentEl.hidden = false;
  } else {
    commentEl.innerHTML = '';
    commentEl.hidden = true;
  }

  // Navigation state
  document.getElementById('btn-prev').disabled = index === 0;
  document.getElementById('btn-next').disabled = index === state.comics.length - 1;
  document.getElementById('comic-counter').textContent = `${index + 1} / ${state.comics.length}`;

  // Scroll to top of comic on navigation (helpful on mobile)
  document.getElementById('comic-display').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function handleKeydown(e) {
  const searchFocused = document.activeElement === document.getElementById('search-input');

  if (searchFocused) {
    if (e.key === 'Escape') {
      closeSearch();
      document.getElementById('search-input').blur();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      if (state.currentIndex > 0) renderComic(state.currentIndex - 1);
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      if (state.currentIndex < state.comics.length - 1) renderComic(state.currentIndex + 1);
      break;
    case '/':
      e.preventDefault();
      document.getElementById('search-input').focus();
      document.getElementById('search-input').select();
      break;
    case 'r':
    case 'R':
      renderComic(Math.floor(Math.random() * state.comics.length));
      break;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const overlay = document.getElementById('loading-overlay');

  try {
    await loadData();
    initSearch();
    renderComic(getInitialIndex());
    overlay.hidden = true;
  } catch (err) {
    overlay.textContent = 'Failed to load archive. Please try refreshing the page.';
    console.error(err);
    return;
  }

  // Navigation buttons
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (state.currentIndex > 0) renderComic(state.currentIndex - 1);
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (state.currentIndex < state.comics.length - 1) renderComic(state.currentIndex + 1);
  });
  document.getElementById('btn-random').addEventListener('click', () => {
    renderComic(Math.floor(Math.random() * state.comics.length));
  });
  document.getElementById('logo-link').addEventListener('click', e => {
    e.preventDefault();
    renderComic(0);
  });

  // Search input
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', e => handleSearch(e.target.value.trim()));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSearch();
      searchInput.blur();
    }
  });

  // Search results (event delegation)
  const resultsEl = document.getElementById('search-results');
  resultsEl.addEventListener('click', e => {
    const el = e.target.closest('[data-number]');
    if (el) navigateToSearchResult(parseInt(el.dataset.number, 10));
  });
  resultsEl.addEventListener('keydown', e => {
    const el = e.target.closest('[data-number]');
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      navigateToSearchResult(parseInt(el.dataset.number, 10));
    }
  });

  // Close search when clicking outside
  document.addEventListener('click', e => {
    if (!document.getElementById('search-container').contains(e.target)) {
      closeSearch();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  // Browser back/forward
  window.addEventListener('popstate', () => {
    const hash = window.location.hash.slice(1);
    const num = parseInt(hash, 10);
    if (!isNaN(num)) {
      const idx = state.comics.findIndex(c => c.number === num);
      if (idx >= 0) renderComic(idx);
    }
  });
});
