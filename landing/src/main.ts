import './styles.css'
import { frontierExplainers, type FrontierExplainer } from '../../shared/frontierExplainers'

type Counter = HTMLElement & {
  dataset: {
    count: string
    suffix?: string
    compact?: string
  }
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const routes = [
  ['Mechanism', '#mechanism'],
  ['Ladders', '#range-orders'],
  ['Mirror', '#mirror-liquidity'],
  ['Markets', '#markets'],
  ['Build', '#build'],
]

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Tabbed code window for the Build section. Every snippet is grounded in the real
// Frontier contracts (PermissionRegistry, IFrontierHooks, the maker-op selectors).
type CodeTab = { id: string; label: string; group: 'permissions' | 'hooks'; lines: string[] }
const codeTabs: CodeTab[] = [
  {
    id: 'perm-grant',
    label: 'Grant',
    group: 'permissions',
    lines: [
      '// Let a market-making bot move your quotes for 7 days — nothing else.',
      '// It can requote, but it can never withdraw your funds.',
      'bytes4[] memory allowed = new bytes4[](2);',
      'allowed[0] = book.requote.selector;     // move your asks',
      'allowed[1] = book.requoteBid.selector;  // move your bids',
      '',
      'permissions.grantSelectorBundle(',
      '    botOperator,                       // who you trust',
      '    address(book),                     // on which book',
      '    allowed,                           // exactly these calls',
      '    uint48(block.timestamp + 7 days)   // auto-expires',
      ');',
    ],
  },
  {
    id: 'perm-revoke',
    label: 'Revoke',
    group: 'permissions',
    lines: [
      '// Cut a bot off instantly — every selector, in one call.',
      'permissions.revokeAll(botOperator, address(book));',
      '',
      '// …or narrow it down to a single power:',
      'permissions.revoke(',
      '    botOperator,',
      '    address(book),',
      '    book.requoteBid.selector   // can no longer touch your bids',
      ');',
    ],
  },
  {
    id: 'hook-oracle',
    label: 'Volume oracle',
    group: 'hooks',
    lines: [
      '// A hook attaches your own logic to the book. This one keeps a',
      '// running volume oracle, updated on every fill — no keeper needed.',
      'contract VolumeOracle is IFrontierHooks {',
      '    uint256 public totalVolume;',
      '',
      '    function afterSweep(address taker, int24 fromTick, int24 reached,',
      '        uint256 paid, uint256 received) external returns (bytes4) {',
      '        totalVolume += received > paid ? received : paid;',
      '        return IFrontierHooks.afterSweep.selector;',
      '    }',
      '}',
    ],
  },
  {
    id: 'hook-allow',
    label: 'Maker allowlist',
    group: 'hooks',
    lines: [
      '// Gate who may post liquidity — revert in beforeDeposit to block a',
      '// maker. Same shape gives KYC’d venues, whitelists, compliance.',
      'contract MakerAllowlist is IFrontierHooks {',
      '    mapping(address => bool) public allowed;',
      '',
      '    function beforeDeposit(address maker, int24, int24, uint128, int128, bool)',
      '        external view returns (bytes4) {',
      '        require(allowed[maker], "maker not allowed");',
      '        return IFrontierHooks.beforeDeposit.selector;',
      '    }',
      '}',
    ],
  },
  {
    id: 'hook-breaker',
    label: 'Circuit breaker',
    group: 'hooks',
    lines: [
      '// Stop a violent move before it lands: revert in beforeSweep if one',
      '// order would push the price past your guardrail.',
      'contract CircuitBreaker is IFrontierHooks {',
      '    int24 public maxMove;',
      '',
      '    function beforeSweep(address taker, int24 fromTick, int24 target)',
      '        external view returns (bytes4) {',
      '        int24 move = target > fromTick ? target - fromTick : fromTick - target;',
      '        require(move <= maxMove, "circuit breaker tripped");',
      '        return IFrontierHooks.beforeSweep.selector;',
      '    }',
      '}',
    ],
  },
]

const SOL_KEYWORDS = new Set([
  'contract', 'is', 'function', 'external', 'public', 'private', 'internal',
  'view', 'pure', 'payable', 'returns', 'return', 'memory', 'storage', 'calldata',
  'require', 'new', 'emit', 'mapping', 'if', 'else', 'for', 'while', 'using',
  'override', 'virtual', 'constant', 'immutable',
])
const SOL_TYPE = /^(?:u?int\d*|address|bool|bytes\d*|string)\b/
const SOL_KW = /^[A-Za-z_$][\w$]*/

function highlightSolidity(line: string): string {
  let s = line
  let prevNonWs = ''
  let out = ''
  const push = (cls: string, text: string) => {
    const safe = escapeHtml(text)
    out += cls ? `<span class="tok-${cls}">${safe}</span>` : safe
  }
  while (s.length) {
    // line comment — rest of the line
    if (s.startsWith('//')) {
      push('comment', s)
      break
    }
    // string literal
    const str = /^"(?:[^"\\]|\\.)*"/.exec(s)
    if (str) {
      push('str', str[0])
      s = s.slice(str[0].length)
      prevNonWs = '"'
      continue
    }
    // type names
    const ty = SOL_TYPE.exec(s)
    if (ty) {
      push('type', ty[0])
      s = s.slice(ty[0].length)
      prevNonWs = ty[0].slice(-1)
      continue
    }
    // identifier / keyword
    const id = SOL_KW.exec(s)
    if (id) {
      const word = id[0]
      const rest = s.slice(word.length)
      let cls = ''
      if (SOL_KEYWORDS.has(word)) cls = 'kw'
      else if (word === 'true' || word === 'false') cls = 'num'
      else if (prevNonWs === '.') cls = 'prop'
      else if (/^\s*\(/.test(rest)) cls = 'fn'
      push(cls, word)
      s = rest
      prevNonWs = word.slice(-1)
      continue
    }
    // number
    const num = /^\d[\w]*/.exec(s)
    if (num) {
      push('num', num[0])
      s = s.slice(num[0].length)
      prevNonWs = num[0].slice(-1)
      continue
    }
    // whitespace
    const ws = /^\s+/.exec(s)
    if (ws) {
      out += ws[0]
      s = s.slice(ws[0].length)
      continue
    }
    // single punctuation / other char
    const ch = s[0]
    push('punct', ch)
    s = s.slice(1)
    prevNonWs = ch
  }
  return out || '&nbsp;'
}

function renderCodeWindow(tabs: CodeTab[]) {
  let lastGroup = ''
  const tabBar = tabs
    .map((t, i) => {
      const sep = lastGroup && lastGroup !== t.group ? '<span class="cw-sep" aria-hidden="true"></span>' : ''
      lastGroup = t.group
      const groupLabel = `<span class="cw-tab-group">${t.group === 'permissions' ? 'PERMISSIONS' : 'HOOKS'}</span>`
      const showGroup = i === 0 || tabs[i - 1].group !== t.group
      return `${sep}<button class="cw-tab${i === 0 ? ' is-active' : ''}" type="button" role="tab" data-cw-tab="${t.id}">${showGroup ? groupLabel : ''}${t.label}</button>`
    })
    .join('')
  const panes = tabs
    .map((t, i) => {
      const body = t.lines
        .map((line) => `<span class="code-line">${highlightSolidity(line)}</span>`)
        .join('')
      return `<pre class="cw-pane${i === 0 ? ' is-active' : ''}" data-cw-pane="${t.id}"><code>${body}</code></pre>`
    })
    .join('')
  return `
    <div class="code-window" data-reveal>
      <div class="cw-bar">
        <span class="cw-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <div class="cw-tabs" role="tablist" aria-label="Permissions and hooks examples">${tabBar}</div>
      </div>
      <div class="cw-body">${panes}</div>
    </div>
  `
}

app.innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand-lockup" href="#top" aria-label="Frontier home">
      <span class="brand-word">FRONTIER</span>
      <span class="brand-mark" aria-hidden="true"></span>
    </a>
    <nav aria-label="Primary navigation">
      ${routes.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}
    </nav>
    <div class="header-actions">
      <a class="nav-link" href="/docs/">Docs</a>
      <a class="button button--small button--primary" href="https://frontier-pm.repo.box">App</a>
    </div>
  </header>

  <main id="main">
    <section id="top" class="hero" aria-labelledby="hero-title">
      <div class="hero-copy" data-reveal>
        <p class="eyebrow">Onchain order-book exchange</p>
        <h1 id="hero-title">FRONTIER</h1>
        <p class="hero-line">A real order book. Onchain. At any size.</p>
        <p class="hero-text">
          Post limit orders, hit the book with market orders, get filled. A large market order pays the same low fee whether it crosses five orders or five thousand — about 214k gas, flat.
        </p>
        <p class="hero-edge">
          No bonding curve, no AMM math. Just a book, a spread, and your fill.
        </p>
        <div class="hero-actions" aria-label="Frontier actions">
          <a class="button button--primary" href="https://frontier-pm.repo.box">Open the app</a>
          <a class="button button--secondary" href="#mechanism">See how it works</a>
        </div>
      </div>

      <div class="hero-terminal" data-reveal aria-label="Live order book preview">
        <div class="terminal-top">
          <span>ETH / USDC</span>
          <span class="mono up">+0.42%</span>
        </div>
        <div class="terminal-book" aria-hidden="true">
          ${renderBookRows('ask')}
          <div class="terminal-mid">
            <span>4,000.00</span>
            <strong>frontier</strong>
          </div>
          ${renderBookRows('bid')}
        </div>
      </div>

      <div class="hero-stats" data-reveal>
        ${renderStat('214,805', 'gas to fill any market order', '214805')}
        ${renderStat('Same fee', 'across 5 or 5,000 prices filled')}
        ${renderStat('1/10¢', 'the smallest price step')}
      </div>
    </section>

    <section id="mechanism" class="section section--dense" aria-labelledby="mechanism-title">
      <div class="section-kicker" data-reveal>Why nobody could do this before</div>
      <div class="split">
        <div data-reveal>
          <h2 id="mechanism-title">Onchain order books broke the moment they got busy.</h2>
          <p>
            Every other onchain book charges the taker for every price level a market order passes
            through — cross a thousand prices, pay for a thousand. So real books never worked onchain,
            and everyone settled for AMMs instead.
          </p>
          <p>
            Frontier fills any market order in one flat step — about 214,805 gas — no matter how many
            orders or prices it crosses. Five or five thousand: same cost. And because filling is cheap,
            prices step in tenths of a cent and makers post across thousands of prices at once.
          </p>
        </div>
        <div class="compression-panel" data-reveal>
          <div class="comparison comparison--frontier">
            <span>Fill across 50 prices</span>
            <strong class="mono up" data-count="214805">0</strong>
            <small>gas, one flat fill</small>
          </div>
          <div class="comparison comparison--frontier">
            <span>Fill across 5,000 prices</span>
            <strong class="mono up" data-count="214805">0</strong>
            <small>gas, the same flat fill</small>
          </div>
          <div class="compression-line" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <p class="panel-note">Cost stays flat as the book gets deep. Takers fill against the best price; resting orders aren't touched until they fill.</p>
        </div>
      </div>
    </section>

    ${frontierExplainers.filter((e) => e.id !== 'sweep').map(renderExplainerSection).join('')}

    <section id="markets" class="section markets" aria-labelledby="markets-title">
      <div class="section-kicker" data-reveal>Trade anything onchain</div>
      <div class="section-heading" data-reveal>
        <h2 id="markets-title">A real book beats a curve whenever an asset has a real market.</h2>
        <p>
          Spot pairs, tokenized stocks and assets, and prediction markets all need visible depth,
          predictable fills, and tight spreads. An AMM curve can't give you that — a real venue can.
        </p>
      </div>
      <div class="market-grid">
        <article data-reveal>
          <span class="market-num" aria-hidden="true">01</span>
          <span class="market-glyph" aria-hidden="true">
            <svg viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="11" y="3" width="12" height="5" rx="1" fill="#2ebd85"/>
              <rect x="6" y="11" width="17" height="5" rx="1" fill="#2ebd85"/>
              <rect x="13" y="19" width="10" height="5" rx="1" fill="#2ebd85"/>
              <rect x="9" y="27" width="14" height="5" rx="1" fill="#2ebd85"/>
              <rect x="25" y="3" width="14" height="5" rx="1" fill="#f6465d"/>
              <rect x="25" y="11" width="9" height="5" rx="1" fill="#f6465d"/>
              <rect x="25" y="19" width="17" height="5" rx="1" fill="#f6465d"/>
              <rect x="25" y="27" width="11" height="5" rx="1" fill="#f6465d"/>
              <line x1="24" y1="1" x2="24" y2="34" stroke="#e6e8ea" stroke-opacity="0.4"/>
            </svg>
          </span>
          <h3>Spot pairs</h3>
          <p>Any token pair gets its own book. Markets are cheap, so flow picks where it trades.</p>
        </article>
        <article data-reveal>
          <span class="market-num" aria-hidden="true">02</span>
          <span class="market-glyph" aria-hidden="true">
            <svg viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="10" y1="4" x2="10" y2="32" stroke="#2ebd85" stroke-width="1.5"/>
              <rect x="6" y="11" width="8" height="13" rx="1" fill="#2ebd85"/>
              <line x1="24" y1="6" x2="24" y2="33" stroke="#f6465d" stroke-width="1.5"/>
              <rect x="20" y="14" width="8" height="12" rx="1" fill="#f6465d"/>
              <line x1="38" y1="3" x2="38" y2="28" stroke="#2ebd85" stroke-width="1.5"/>
              <rect x="34" y="9" width="8" height="12" rx="1" fill="#2ebd85"/>
            </svg>
          </span>
          <h3>Stocks &amp; tokenized assets</h3>
          <p>Compliant tokens keep issuer rules and account freezes, while maker positions stay protected for the rightful owner.</p>
        </article>
        <article data-reveal>
          <span class="market-num" aria-hidden="true">03</span>
          <span class="market-glyph" aria-hidden="true">
            <svg viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="14" width="25" height="8" rx="2" fill="#2ebd85"/>
              <rect x="29" y="14" width="15" height="8" rx="2" fill="#f6465d"/>
              <line x1="29" y1="10" x2="29" y2="26" stroke="#f0b90b" stroke-width="2"/>
              <rect x="4" y="14" width="40" height="8" rx="2" stroke="#e6e8ea" stroke-opacity="0.18"/>
            </svg>
          </span>
          <h3>Prediction markets</h3>
          <p>Linked YES/NO books show probability as price and conviction as depth.</p>
        </article>
      </div>
    </section>

    <section id="build" class="section custody" aria-labelledby="build-title">
      <div class="section-kicker" data-reveal>Programmable, without giving up custody</div>
      <div class="build-layout">
        <div class="build-head" data-reveal>
          <h2 id="build-title">Programmable, never custodial.</h2>
          <p>
            Frontier runs on a granular permission system. Hand a market-making bot exactly the powers you
            choose — requote, rebalance, recycle — and nothing else. It can manage your orders but never
            withdraw your funds; fills and refunds always pay you.
          </p>
          <p>
            Hooks let you attach your own logic to the book itself — custom markets, fee rules, strategies,
            entire products running on top of real onchain liquidity. Click through the tabs.
          </p>
        </div>
        ${renderCodeWindow(codeTabs)}
      </div>
    </section>

    <section class="closing" aria-labelledby="closing-title">
      <div data-reveal>
        <p class="eyebrow">The book is open</p>
        <h2 id="closing-title">Bring the order book back onchain.</h2>
        <p>Trade the live demo, see how it works, then launch the market that's been waiting for a real book.</p>
        <div class="hero-actions">
          <a class="button button--primary" href="https://frontier-pm.repo.box">Open the app</a>
          <a class="button button--secondary" href="/docs/">Read the docs</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <a href="https://frontier-pm.repo.box">App</a>
    <a href="/docs/">Docs</a>
    <a href="https://github.com/yolo-maxi/frontier-orderbook">GitHub</a>
  </footer>
`

function renderBookRows(side: 'ask' | 'bid') {
  const values =
    side === 'ask'
      ? [
          ['4,001.20', '18.42', 74],
          ['4,000.80', '12.10', 54],
          ['4,000.40', '22.09', 88],
        ]
      : [
          ['3,999.60', '16.30', 64],
          ['3,999.20', '26.44', 94],
          ['3,998.80', '14.87', 58],
        ]

  return values
    .map(
      ([price, size, width]) => `
        <div class="book-row book-row--${side}">
          <span>${price}</span>
          <span>${size}</span>
          <i style="--depth:${width}%"></i>
        </div>`,
    )
    .join('')
}

function renderStat(value: string, label: string, count?: string, suffix?: string, note?: string) {
  const data = count ? `data-count="${count}"${suffix ? ` data-suffix="${suffix}"` : ''}` : ''
  return `
    <div class="stat">
      <strong class="mono" ${data}>${count ? '0' : value}</strong>
      <span>${label}</span>
      ${note ? `<span class="stat-note">${note}</span>` : ''}
    </div>
  `
}

function renderExplainerSection(explainer: FrontierExplainer) {
  const id =
    explainer.id === 'range'
      ? 'range-orders'
      : explainer.id === 'fill'
        ? 'taker-fill'
        : explainer.id === 'mirror'
          ? 'mirror-liquidity'
          : 'frontier-sweep'
  const reversed = explainer.id === 'mirror' ? ' feature-section--reverse' : ''
  const controls = `<button class="replay-button" type="button" data-replay="${explainer.id}">Replay</button>`

  return `
    <section id="${id}" class="section feature-section${reversed}" aria-labelledby="${id}-title">
      <div class="feature-copy" data-reveal>
        <p class="section-kicker">${explainer.eyebrow}</p>
        <h2 id="${id}-title">${explainer.title}</h2>
        <p>${explainer.summary}</p>
        <ul>
          ${explainer.bullets.map((item) => `<li>${item}</li>`).join('')}
        </ul>
      </div>
      <div class="explainer-card" data-explainer="${explainer.id}" data-reveal>
        <div class="explainer-toolbar">
          <span>${explainer.eyebrow}</span>
          ${controls}
        </div>
        ${explainer.svg}
        <p>${explainer.caption}</p>
      </div>
    </section>
  `
}

function initReveal() {
  const targets = [...document.querySelectorAll<HTMLElement>('[data-reveal], .explainer-card')]
  if (!('IntersectionObserver' in window)) {
    targets.forEach((target) => target.classList.add('is-visible'))
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
  )

  targets.forEach((target) => observer.observe(target))
}

function initCounters() {
  const counters = [...document.querySelectorAll<Counter>('[data-count]')]
  const run = (counter: Counter) => {
    const target = Number(counter.dataset.count)
    const suffix = counter.dataset.suffix ?? ''
    const compact = counter.dataset.compact === 'true'
    const start = performance.now()
    const duration = reducedMotion ? 0 : 900

    const frame = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const value = target * eased
      counter.textContent = compact ? formatCompact(value) : Math.round(value).toLocaleString('en-US') + suffix
      if (t < 1) requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
  }

  if (!('IntersectionObserver' in window)) {
    counters.forEach(run)
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          run(entry.target as Counter)
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.5 },
  )

  counters.forEach((counter) => observer.observe(counter))
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value).toLocaleString('en-US')}`
  return `${Math.round(value)}`
}

function initReplayButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest<HTMLElement>('.explainer-card')
      if (!card) return
      // Remove is-visible too: the reveal animations live on .is-visible, so
      // toggling only .is-replaying never actually restarts them. Drop both,
      // force a reflow, then re-add to replay from frame zero.
      card.classList.remove('is-visible', 'is-replaying')
      void card.offsetWidth
      card.classList.add('is-visible', 'is-replaying')
      window.setTimeout(() => card.classList.remove('is-replaying'), 2600)
    })
  })
}

function initCodeTabs() {
  document.querySelectorAll<HTMLButtonElement>('[data-cw-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-cw-tab')
      const win = button.closest<HTMLElement>('.code-window')
      if (!win || !id) return
      win.querySelectorAll<HTMLElement>('[data-cw-tab]').forEach((b) => b.classList.toggle('is-active', b === button))
      win.querySelectorAll<HTMLElement>('[data-cw-pane]').forEach((p) =>
        p.classList.toggle('is-active', p.getAttribute('data-cw-pane') === id),
      )
    })
  })
}

function initHeaderState() {
  const header = document.querySelector<HTMLElement>('.site-header')
  if (!header) return
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 20)
  update()
  window.addEventListener('scroll', update, { passive: true })
}

class MarketField {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2)
  private width = 0
  private height = 0
  private tick = 0
  private pointer = { x: 0.5, y: 0.5 }
  private particles = Array.from({ length: 52 }, (_, index) => ({
    x: (index * 97) % 1000,
    y: (index * 173) % 1000,
    r: 0.7 + (index % 4) * 0.35,
    s: 0.15 + (index % 7) * 0.035,
  }))

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.canvas = canvas
    this.ctx = ctx
    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener(
      'pointermove',
      (event) => {
        this.pointer = { x: event.clientX / Math.max(1, this.width), y: event.clientY / Math.max(1, this.height) }
      },
      { passive: true },
    )
  }

  start() {
    this.draw()
    if (!reducedMotion) requestAnimationFrame(() => this.loop())
  }

  private loop() {
    this.tick += 1
    this.draw()
    requestAnimationFrame(() => this.loop())
  }

  private resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = Math.floor(this.width * this.dpr)
    this.canvas.height = Math.floor(this.height * this.dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.draw()
  }

  private draw() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.fillStyle = '#0b0e11'
    ctx.fillRect(0, 0, this.width, this.height)

    this.drawGrid(ctx)
    this.drawDepth(ctx)
    this.drawParticles(ctx)
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.strokeStyle = '#2ebd85'
    ctx.lineWidth = 1
    const offset = reducedMotion ? 0 : (this.tick * 0.18) % 48
    for (let x = -48 + offset; x < this.width + 48; x += 48) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.height)
      ctx.stroke()
    }
    for (let y = -48 + offset; y < this.height + 48; y += 48) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(this.width, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawDepth(ctx: CanvasRenderingContext2D) {
    const centerX = this.width * (0.68 + (this.pointer.x - 0.5) * 0.025)
    const centerY = this.height * 0.5
    const rows = 12
    ctx.save()
    ctx.globalAlpha = 0.5
    for (let i = 0; i < rows; i += 1) {
      const y = centerY - 230 + i * 42
      const side = i < rows / 2 ? 'ask' : 'bid'
      const width = 88 + ((i * 37 + this.tick) % 150)
      ctx.fillStyle = side === 'ask' ? 'rgba(246,70,93,.28)' : 'rgba(46,189,133,.28)'
      ctx.fillRect(centerX - width / 2, y, width, 12)
    }

    const edgeX = centerX + Math.sin(this.tick / 80) * 24
    ctx.globalAlpha = 0.82
    ctx.strokeStyle = '#2ebd85'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(edgeX, centerY - 260)
    ctx.lineTo(edgeX, centerY + 260)
    ctx.stroke()
    ctx.restore()
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    ctx.save()
    for (const particle of this.particles) {
      const x = ((particle.x + this.tick * particle.s * 7) % 1000) / 1000 * this.width
      const y = ((particle.y + this.tick * particle.s * 3) % 1000) / 1000 * this.height
      const near = Math.max(0, 1 - Math.hypot(x - this.pointer.x * this.width, y - this.pointer.y * this.height) / 320)
      ctx.globalAlpha = 0.2 + near * 0.32
      ctx.fillStyle = particle.r > 1.4 ? '#f0b90b' : '#8a93a0'
      ctx.beginPath()
      ctx.arc(x, y, particle.r + near, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

function initCanvas() {
  const canvas = document.querySelector<HTMLCanvasElement>('#market-field')
  if (!canvas) return
  new MarketField(canvas).start()
}

initReveal()
initCounters()
initReplayButtons()
initCodeTabs()
initHeaderState()
initCanvas()
