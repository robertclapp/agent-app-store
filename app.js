// ============================================
// AGENT APP STORE — Application Logic
// ============================================

// --- Theme Toggle ---
(function () {
  const t = document.querySelector('[data-theme-toggle]'),
    r = document.documentElement;
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  t &&
    t.addEventListener('click', () => {
      d = d === 'dark' ? 'light' : 'dark';
      r.setAttribute('data-theme', d);
      t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode');
      t.innerHTML =
        d === 'dark'
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    });
})();

// --- Lucide Icon Map (tool -> lucide icon name) ---
const ICON_MAP = {
  'search': 'search',
  'shield': 'shield',
  'github': 'github',
  'book-open': 'book-open',
  'message-square': 'message-square',
  'monitor': 'monitor',
  'flame': 'flame',
  'layers': 'layers',
  'server': 'server',
  'activity': 'activity',
  'pen-tool': 'pen-tool',
  'mail': 'mail',
  'brain': 'brain',
  'sparkles': 'sparkles',
  'clipboard-list': 'clipboard-list',
  'box': 'package',
  'alert-triangle': 'alert-triangle',
  'database': 'database',
};

// --- Category Display Names & Colors ---
const CATEGORIES = {
  'all': { label: 'All Tools', icon: 'grid-3x3' },
  'search-and-data': { label: 'Search & Data', icon: 'search', color: 'var(--color-search)' },
  'developer-tools': { label: 'Developer Tools', icon: 'code-2', color: 'var(--color-devtools)' },
  'productivity': { label: 'Productivity', icon: 'zap', color: 'var(--color-productivity)' },
  'communication': { label: 'Communication', icon: 'message-circle', color: 'var(--color-communication)' },
  'data-and-analytics': { label: 'Data & Analytics', icon: 'bar-chart-3', color: 'var(--color-data)' },
  'infrastructure': { label: 'Infrastructure', icon: 'server', color: 'var(--color-infra)' },
  'design': { label: 'Design', icon: 'palette', color: 'var(--color-design)' },
  'ai-and-ml': { label: 'AI & ML', icon: 'brain', color: 'var(--color-ai)' },
  'security': { label: 'Security', icon: 'shield', color: 'var(--color-security)' },
};

// --- Business Readiness Toolkit ---
const READINESS_TOOLS = [
  {
    icon: 'file-json',
    title: 'Agent Manifest Generator',
    description: 'Generate a /.well-known/agent.json file for your domain. Describes your business capabilities, API endpoints, and how agents should interact with your services. Deploy it and you\'re on the map.',
    tag: 'Essential',
    cta: 'Generate manifest'
  },
  {
    icon: 'plug',
    title: 'MCP Server Scaffold',
    description: 'Scaffold a custom MCP server that wraps your existing API. Agents get structured tool definitions, typed inputs/outputs, and auth flows — without rewriting your backend.',
    tag: 'Developer',
    cta: 'Start scaffolding'
  },
  {
    icon: 'shield-check',
    title: 'Agent Auth Gateway',
    description: 'Secure gateway for agent-to-service authentication. Issues scoped tokens, enforces rate limits, logs all agent interactions. Drop-in middleware for Express, FastAPI, or any HTTP server.',
    tag: 'Security',
    cta: 'View docs'
  },
  {
    icon: 'test-tube',
    title: 'Agent Compatibility Tester',
    description: 'Test your API against the top 10 agent frameworks. Validates response schemas, error handling, auth flows, and streaming support. Get a compatibility score and fix list.',
    tag: 'QA',
    cta: 'Run tests'
  },
  {
    icon: 'book-text',
    title: 'LLM-Readable Docs Converter',
    description: 'Convert your existing API documentation into structured, LLM-optimized format. Agents can parse these instantly — no scraping, no guessing at parameters. Supports OpenAPI, GraphQL, and gRPC.',
    tag: 'Documentation',
    cta: 'Convert docs'
  },
  {
    icon: 'bar-chart-2',
    title: 'Agent Analytics Dashboard',
    description: 'Track how agents discover and use your services. See which capabilities are most queried, common failure points, popular workflow patterns, and agent-initiated revenue attribution.',
    tag: 'Analytics',
    cta: 'Set up tracking'
  },
];

// --- State ---
let tools = [];
let activeCategory = 'all';
let searchQuery = '';

// --- Load Registry ---
async function loadRegistry() {
  try {
    const res = await fetch('./registry.json');
    const data = await res.json();
    tools = data.tools;
    renderFilters();
    renderGrid();
  } catch (e) {
    console.error('Failed to load registry:', e);
  }
}

// --- Render Category Filters ---
function renderFilters() {
  const container = document.querySelector('.category-filters');
  const counts = { all: tools.length };
  tools.forEach(t => {
    counts[t.category] = (counts[t.category] || 0) + 1;
  });

  let html = '';
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (key !== 'all' && !counts[key]) continue;
    const active = activeCategory === key ? ' active' : '';
    html += `<button class="filter-btn${active}" data-category="${key}" role="tab" aria-selected="${activeCategory === key}">
      <i data-lucide="${cat.icon}" style="width:14px;height:14px;"></i>
      ${cat.label}
      <span class="count">${counts[key] || 0}</span>
    </button>`;
  }
  container.innerHTML = html;
  lucide.createIcons();

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category;
      renderFilters();
      renderGrid();
    });
  });
}

// --- Render Tool Grid ---
function renderGrid() {
  const grid = document.getElementById('tool-grid');
  let filtered = tools;

  if (activeCategory !== 'all') {
    filtered = filtered.filter(t => t.category === activeCategory);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.tagline.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q)) ||
      t.capabilities.some(c => c.toLowerCase().includes(q)) ||
      t.protocol.toLowerCase().includes(q)
    );
  }

  // Sort by popularity
  filtered.sort((a, b) => b.popularity - a.popularity);

  // Update count
  document.getElementById('tool-count').textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <i data-lucide="search-x" aria-hidden="true"></i>
        <h3>No tools found</h3>
        <p>Try a different search term or category filter.</p>
      </div>`;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = filtered.map(tool => {
    const catColor = CATEGORIES[tool.category]?.color || 'var(--color-primary)';
    const iconName = ICON_MAP[tool.logo_icon] || 'box';
    const topTags = tool.tags.slice(0, 3);

    return `
      <article class="tool-card" data-tool-id="${tool.id}" tabindex="0" role="button" aria-label="View details for ${tool.name}">
        <div class="card-header">
          <div class="card-icon" style="background:${catColor};">
            <i data-lucide="${iconName}"></i>
          </div>
          <div class="card-meta">
            <div class="card-name">${tool.name}</div>
            <span class="card-protocol">${tool.protocol}</span>
          </div>
        </div>
        <p class="card-tagline">${tool.tagline}</p>
        <div class="card-footer">
          <div class="card-tags">
            ${topTags.map(tag => `<span class="card-tag">${tag}</span>`).join('')}
          </div>
          ${tool.verified ? `<span class="card-verified"><i data-lucide="badge-check" style="width:14px;height:14px;"></i> Verified</span>` : ''}
        </div>
      </article>`;
  }).join('');

  lucide.createIcons();

  // Attach click handlers
  grid.querySelectorAll('.tool-card').forEach(card => {
    const handler = () => openModal(card.dataset.toolId);
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

// --- Render Business Readiness Grid ---
function renderReadiness() {
  const grid = document.getElementById('readiness-grid');
  if (!grid) return;

  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
    gap: var(--space-4);
    margin-top: var(--space-8);
  `;

  grid.innerHTML = READINESS_TOOLS.map(tool => `
    <div style="
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      padding: var(--space-5);
      box-shadow: var(--shadow-card);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          background: var(--color-primary-surface);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-primary);
        ">
          <i data-lucide="${tool.icon}" style="width:20px;height:20px;"></i>
        </div>
        <span style="
          font-size: var(--text-xs);
          font-family: var(--font-mono);
          color: var(--color-primary);
          background: var(--color-primary-surface);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          border: 1px solid var(--color-primary-highlight);
        ">${tool.tag}</span>
      </div>
      <h3 style="
        font-family: var(--font-display);
        font-weight: 700;
        font-size: var(--text-base);
        line-height: 1.2;
      ">${tool.title}</h3>
      <p style="
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        line-height: 1.5;
        flex: 1;
      ">${tool.description}</p>
      <button style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: var(--text-sm);
        background: var(--color-surface-offset);
        color: var(--color-text);
        border: 1px solid var(--color-border);
        cursor: pointer;
        width: 100%;
        font-family: var(--font-body);
        transition: background 180ms ease, border-color 180ms ease;
      " onmouseover="this.style.background='var(--color-surface-dynamic)'" onmouseout="this.style.background='var(--color-surface-offset)'">${tool.cta}
        <i data-lucide="arrow-right" style="width:14px;height:14px;"></i>
      </button>
    </div>
  `).join('');

  lucide.createIcons();
}

// --- Modal ---
function openModal(toolId) {
  const tool = tools.find(t => t.id === toolId);
  if (!tool) return;

  const catColor = CATEGORIES[tool.category]?.color || 'var(--color-primary)';
  const iconName = ICON_MAP[tool.logo_icon] || 'box';

  // Icon
  const modalIcon = document.getElementById('modal-icon');
  modalIcon.style.background = catColor;
  modalIcon.innerHTML = `<i data-lucide="${iconName}"></i>`;

  // Title
  document.getElementById('modal-title').textContent = tool.name;
  document.getElementById('modal-tagline').textContent = tool.tagline;

  // Body
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div class="modal-section">
      <h3>About</h3>
      <p class="modal-description">${tool.description}</p>
    </div>

    <div class="modal-section">
      <h3>Details</h3>
      <div class="modal-meta-grid">
        <div class="meta-item">
          <div class="meta-label">Protocol</div>
          <div class="meta-value">${tool.protocol}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Auth</div>
          <div class="meta-value">${tool.auth.type === 'none' ? 'None required' : tool.auth.type.replace('_', ' ').toUpperCase()}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Pricing</div>
          <div class="meta-value">${tool.pricing.free_tier ? 'Free tier' : 'Paid'}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Category</div>
          <div class="meta-value">${CATEGORIES[tool.category]?.label || tool.category}</div>
        </div>
      </div>
    </div>

    <div class="modal-section">
      <h3>Capabilities</h3>
      <div class="capability-list">
        ${tool.capabilities.map(c => `<span class="capability-chip">${c}</span>`).join('')}
      </div>
    </div>

    <div class="modal-section">
      <h3>Agent Integration</h3>
      <div class="modal-code">
<pre>${tool.protocol === 'MCP' ?
`// Install MCP Server
npx ${tool.endpoints.package || 'mcp-server'}

// Or add to your agent config:
{
  "mcpServers": {
    "${tool.id}": {
      "command": "npx",
      "args": ["${tool.endpoints.package || ''}"]${tool.auth.type !== 'none' ? `,
      "env": {
        "${tool.auth.env_var || 'API_KEY'}": "your-key"
      }` : ''}
    }
  }
}` :
`// REST API Integration
const response = await fetch(
  "${tool.endpoints.base_url || ''}",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "${tool.auth.header || 'Authorization'}": "${tool.auth.prefix ? tool.auth.prefix + ' ' : ''}your-api-key"
    },
    body: JSON.stringify({
      // See docs for request schema
    })
  }
);`}</pre>
      </div>
    </div>

    ${tool.pricing.details ? `
    <div class="modal-section">
      <h3>Pricing</h3>
      <p class="modal-description">${tool.pricing.details}</p>
    </div>` : ''}
  `;

  // CTA
  const cta = document.getElementById('modal-cta');
  const docsUrl = tool.endpoints.docs || tool.endpoints.base_url || '#';
  cta.innerHTML = `
    <a href="${docsUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary">
      <i data-lucide="external-link" style="width:16px;height:16px;"></i>
      Open Docs
    </a>
    <button class="btn-secondary" onclick="copyToolJSON('${tool.id}')">
      <i data-lucide="copy" style="width:16px;height:16px;"></i>
      Copy JSON
    </button>
  `;

  // Show
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  lucide.createIcons();

  // Focus close button
  setTimeout(() => document.getElementById('modal-close').focus(), 100);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Copy tool JSON to clipboard
function copyToolJSON(toolId) {
  const tool = tools.find(t => t.id === toolId);
  if (!tool) return;
  const json = JSON.stringify(tool, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = document.querySelector('.modal-cta .btn-secondary');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="check" style="width:16px;height:16px;"></i> Copied';
      lucide.createIcons();
      setTimeout(() => { btn.innerHTML = orig; lucide.createIcons(); }, 1500);
    }
  }).catch(() => {});
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
  loadRegistry();
  renderReadiness();

  // Search
  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      renderGrid();
    }, 200);
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
});
