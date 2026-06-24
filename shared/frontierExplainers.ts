export type ExplainerId = 'range' | 'fill' | 'mirror' | 'sweep'

export type FrontierExplainer = {
  id: ExplainerId
  eyebrow: string
  title: string
  summary: string
  caption: string
  bullets: string[]
  svg: string
}

export const frontierExplainers: FrontierExplainer[] = [
  {
    id: 'range',
    eyebrow: 'Ladder orders',
    title: "Many makers' orders, one clean book.",
    summary:
      'Each maker posts a ladder — limit orders spread across the prices they pick. Frontier stacks every overlapping order into one depth per price, so takers see a single, clean book.',
    caption:
      "Gold bands are individual ladders, one per address, each spanning its own price range. Green is the combined depth at each price — the size every taker actually fills against. Many makers in, one book out.",
    bullets: [
      'Each address posts its own ladder across any range of prices.',
      'Overlapping orders combine into one depth per price.',
      'Takers fill against the combined depth, never individual orders.',
    ],
    svg: `
<svg class="fx-visual fx-visual--range" viewBox="0 0 760 440" role="img" aria-labelledby="fx-range-title fx-range-desc">
  <title id="fx-range-title">Animated range order ladder</title>
  <desc id="fx-range-desc">A maker drags one gold preview across many ticks; it lands as a full ladder of limit orders in a single transaction that writes only the two endpoints.</desc>
  <defs>
    <linearGradient id="fx-range-sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f0b90b" stop-opacity="0"/>
      <stop offset=".5" stop-color="#f0b90b" stop-opacity=".82"/>
      <stop offset="1" stop-color="#f0b90b" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect class="fx-screen" x="1" y="1" width="758" height="438" rx="8"/>
  <text class="fx-dim-title" x="394" y="34" text-anchor="middle">MANY LADDERS → ONE CLEAN BOOK</text>
  <g class="fx-legend">
    <rect class="fx-legend-green" x="120" y="52" width="16" height="12" rx="2"/>
    <text class="fx-legend-txt" x="144" y="62">combined depth — what takers fill against</text>
    <rect class="fx-legend-gold" x="430" y="52" width="16" height="12" rx="2"/>
    <text class="fx-legend-txt" x="454" y="62">each address = one maker's ladder</text>
  </g>
  <text class="fx-axis-label" x="40" y="270" transform="rotate(-90 40 270)" text-anchor="middle">DEPTH</text>
  <line class="fx-dim-axis" x1="120" y1="184" x2="120" y2="360"/>
  <line class="fx-dim-axis" x1="120" y1="360" x2="690" y2="360"/>
  <g class="fx-depth">
    <rect class="fx-depth-col fx-dc-1" x="127" y="306" width="50" height="54"/>
    <rect class="fx-depth-col fx-dc-2" x="190" y="266" width="50" height="94"/>
    <rect class="fx-depth-col fx-dc-3" x="253" y="226" width="50" height="134"/>
    <rect class="fx-depth-col fx-dc-4" x="316" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-5" x="379" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-6" x="442" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-7" x="505" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-8" x="568" y="266" width="50" height="94"/>
    <rect class="fx-depth-col fx-dc-9" x="631" y="266" width="50" height="94"/>
  </g>
  <g class="fx-users">
    <g class="fx-user fx-ub-1">
      <rect class="fx-user-band" x="127" y="325" width="554" height="30" rx="3"/>
      <text class="fx-user-addr" x="137" y="345">0x4f2a…b1</text>
    </g>
    <g class="fx-user fx-ub-2">
      <rect class="fx-user-band" x="190" y="285" width="491" height="30" rx="3"/>
      <text class="fx-user-addr" x="200" y="305">0x9c07…3d</text>
    </g>
    <g class="fx-user fx-ub-3">
      <rect class="fx-user-band" x="253" y="245" width="302" height="30" rx="3"/>
      <text class="fx-user-addr" x="263" y="265">0x1be4…7a</text>
    </g>
    <g class="fx-user fx-ub-4">
      <rect class="fx-user-band" x="316" y="205" width="239" height="30" rx="3"/>
      <text class="fx-user-addr" x="326" y="225">0xa3d8…0c</text>
    </g>
  </g>
  <g class="fx-tick-labels">
    <text class="fx-tick-px" x="152" y="378" text-anchor="middle">.00</text>
    <text class="fx-tick-px" x="215" y="378" text-anchor="middle">.01</text>
    <text class="fx-tick-px" x="278" y="378" text-anchor="middle">.02</text>
    <text class="fx-tick-px" x="341" y="378" text-anchor="middle">.03</text>
    <text class="fx-tick-px" x="404" y="378" text-anchor="middle">.04</text>
    <text class="fx-tick-px" x="467" y="378" text-anchor="middle">.05</text>
    <text class="fx-tick-px" x="530" y="378" text-anchor="middle">.06</text>
    <text class="fx-tick-px" x="593" y="378" text-anchor="middle">.07</text>
    <text class="fx-tick-px" x="656" y="378" text-anchor="middle">.08</text>
    <text class="fx-axis-label fx-axis-x" x="404" y="402" text-anchor="middle">PRICE  (4000.00 → 4000.08)</text>
  </g>
</svg>`,
  },
  {
    id: 'fill',
    eyebrow: 'Getting filled',
    title: 'One market order, every maker in its path paid.',
    summary:
      'A market order fills from the best price inward, taking depth price by price until your size runs out. Because that depth is many makers stacked together, one fill pays every maker it crosses — in a single trade.',
    caption:
      'Red is the depth your market order takes, filled from the best price inward and stopping where your size runs out. Every maker whose orders sit in that range is paid at once (✓); makers beyond the fill are untouched.',
    bullets: [
      'Takers fill against the combined depth, never individual orders.',
      'One fill pays every maker in its price path, pro-rata.',
      'The fill stops at the price where your size runs out.',
    ],
    svg: `
<svg class="fx-visual fx-visual--range" viewBox="0 0 760 440" role="img" aria-labelledby="fx-fill-title fx-fill-desc">
  <title id="fx-fill-title">Animated taker fill across aggregate depth</title>
  <desc id="fx-fill-desc">A taker order eats green depth from the touch inward; the consumed depth fills red from the left and stops mid-book, marking every maker it drew from.</desc>
  <defs>
    <marker id="fx-fill-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#ff6363"/>
    </marker>
  </defs>
  <rect class="fx-screen" x="1" y="1" width="758" height="438" rx="8"/>
  <text class="fx-dim-title" x="394" y="34" text-anchor="middle">ONE MARKET ORDER → MANY MAKERS PAID</text>
  <g class="fx-legend">
    <rect class="fx-legend-green" x="96" y="52" width="16" height="12" rx="2"/>
    <text class="fx-legend-txt" x="120" y="62">resting depth</text>
    <rect class="fx-legend-red" x="250" y="52" width="16" height="12" rx="2"/>
    <text class="fx-legend-txt" x="274" y="62">filled by the order</text>
    <rect class="fx-legend-gold" x="470" y="52" width="16" height="12" rx="2"/>
    <text class="fx-legend-txt" x="494" y="62">each address = a maker</text>
  </g>
  <text class="fx-axis-label" x="40" y="270" transform="rotate(-90 40 270)" text-anchor="middle">DEPTH</text>
  <line class="fx-dim-axis" x1="120" y1="170" x2="120" y2="360"/>
  <line class="fx-dim-axis" x1="120" y1="360" x2="690" y2="360"/>
  <g class="fx-depth">
    <rect class="fx-depth-col fx-dc-1" x="127" y="306" width="50" height="54"/>
    <rect class="fx-depth-col fx-dc-2" x="190" y="266" width="50" height="94"/>
    <rect class="fx-depth-col fx-dc-3" x="253" y="226" width="50" height="134"/>
    <rect class="fx-depth-col fx-dc-4" x="316" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-5" x="379" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-6" x="442" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-7" x="505" y="186" width="50" height="174"/>
    <rect class="fx-depth-col fx-dc-8" x="568" y="266" width="50" height="94"/>
    <rect class="fx-depth-col fx-dc-9" x="631" y="266" width="50" height="94"/>
  </g>
  <g class="fx-users">
    <g class="fx-user fx-ub-1">
      <rect class="fx-user-band" x="127" y="325" width="554" height="30" rx="3"/>
      <text class="fx-user-addr" x="137" y="345">0x4f2a…b1</text>
    </g>
    <g class="fx-user fx-ub-2">
      <rect class="fx-user-band" x="190" y="285" width="491" height="30" rx="3"/>
      <text class="fx-user-addr" x="200" y="305">0x9c07…3d</text>
    </g>
    <g class="fx-user fx-ub-3">
      <rect class="fx-user-band" x="253" y="245" width="302" height="30" rx="3"/>
      <text class="fx-user-addr" x="263" y="265">0x1be4…7a</text>
    </g>
    <g class="fx-user fx-ub-4">
      <rect class="fx-user-band" x="316" y="205" width="239" height="30" rx="3"/>
      <text class="fx-user-addr fx-addr-dim" x="326" y="225">0xa3d8…0c</text>
    </g>
  </g>
  <g class="fx-fill">
    <rect class="fx-fill-col fx-fc-1" x="127" y="306" width="50" height="54"/>
    <rect class="fx-fill-col fx-fc-2" x="190" y="266" width="50" height="94"/>
    <rect class="fx-fill-col fx-fc-3" x="253" y="226" width="50" height="134"/>
  </g>
  <line class="fx-fill-front" x1="308" y1="176" x2="308" y2="360"/>
  <text class="fx-fill-front-label" x="316" y="184">fill stops here</text>
  <line class="fx-taker-arrow" x1="138" y1="150" x2="296" y2="150" marker-end="url(#fx-fill-arrow)"/>
  <text class="fx-taker-label" x="138" y="140">MARKET BUY — fills from the best price in</text>
  <g class="fx-checks">
    <text class="fx-maker-check fx-mc-1" x="232" y="345">✓</text>
    <text class="fx-maker-check fx-mc-2" x="295" y="305">✓</text>
    <text class="fx-maker-check fx-mc-3" x="358" y="265">✓</text>
  </g>
  <g class="fx-tick-labels">
    <text class="fx-tick-px" x="152" y="378" text-anchor="middle">.00</text>
    <text class="fx-tick-px" x="215" y="378" text-anchor="middle">.01</text>
    <text class="fx-tick-px" x="278" y="378" text-anchor="middle">.02</text>
    <text class="fx-tick-px" x="341" y="378" text-anchor="middle">.03</text>
    <text class="fx-tick-px" x="404" y="378" text-anchor="middle">.04</text>
    <text class="fx-tick-px" x="467" y="378" text-anchor="middle">.05</text>
    <text class="fx-tick-px" x="530" y="378" text-anchor="middle">.06</text>
    <text class="fx-tick-px" x="593" y="378" text-anchor="middle">.07</text>
    <text class="fx-tick-px" x="656" y="378" text-anchor="middle">.08</text>
    <text class="fx-axis-label fx-axis-x" x="404" y="402" text-anchor="middle">PRICE  (4000.00 → 4000.08)</text>
  </g>
</svg>`,
  },
  {
    id: 'mirror',
    eyebrow: 'Mirror liquidity',
    title: 'Back the book without managing orders.',
    summary:
      'Your resting bids and asks are the base layer. Mirror liquidity stacks on top of every bar in gold, adding depth across the book — and when a trade moves the price or a new maker shows up, it follows them instantly.',
    caption:
      'Green and red are resting depth; gold is mirror liquidity stacked on top. Watch it follow a trade across the book, then mirror a new maker the moment they quote.',
    bullets: [
      'Mirror liquidity adds depth on top of every resting bar.',
      'When a trade moves the price, your mirror depth follows it across the book.',
      'A new maker gets mirrored the instant they quote — no bot, no requoting.',
    ],
    svg: `
<svg class="fx-visual fx-visual--mirror" viewBox="0 0 760 440" role="img" aria-labelledby="fx-mirror-title fx-mirror-desc">
  <title id="fx-mirror-title">Mirror liquidity on the depth book</title>
  <desc id="fx-mirror-desc">A valley-shaped order book with a one-column spread at the price. Discrete trades step the price; bids grow up to follow it in sync with the line; a fixed pool of gold mirror liquidity (1:1 with each bar) flows to stay on the innermost orders. Loops continuously.</desc>
  <defs>
    <linearGradient id="cl-bid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3ddc97" stop-opacity="1"/>
      <stop offset="1" stop-color="#2ebd85" stop-opacity=".25"/>
    </linearGradient>
    <linearGradient id="cl-ask" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff6b7f" stop-opacity="1"/>
      <stop offset="1" stop-color="#f6465d" stop-opacity=".25"/>
    </linearGradient>
    <pattern id="cl-gold" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
      <rect width="8" height="8" fill="#f0b90b" fill-opacity=".16"/>
      <path d="M0 0V8" stroke="#f0b90b" stroke-width="3" stroke-opacity=".9"/>
    </pattern>
  </defs>
  <rect class="fx-screen" x="1" y="1" width="758" height="438" rx="8"/>

  <g class="fx-cl-head" font-family="ui-monospace, 'SF Mono', Menlo, monospace">
    <rect x="40" y="30" width="132" height="42" rx="21" fill="rgba(46,189,133,0.16)" stroke="rgba(46,189,133,0.55)"/>
    <text x="64" y="57" fill="#3ddc97" font-size="17" font-weight="600">Yes</text>
    <text x="106" y="57" fill="#e6e8ea" font-size="17" font-weight="700">43¢</text>
    <rect x="184" y="30" width="124" height="42" rx="21" fill="none" stroke="rgba(230,232,234,0.2)"/>
    <text x="208" y="57" fill="#8a93a0" font-size="17">No</text>
    <text x="246" y="57" fill="#c7ccd2" font-size="17">51¢</text>
    <text x="722" y="44" text-anchor="end" fill="#8a93a0" font-size="12" letter-spacing="1.5">MEDIAN</text>
    <text x="722" y="76" text-anchor="end" fill="#3ddc97" font-size="30" font-weight="700">43%</text>
  </g>

  <g class="fx-cl-bars">
    <rect x="108" y="326" width="20" height="34" rx="4" fill="url(#cl-bid)"/>
    <rect x="134" y="312" width="20" height="48" rx="4" fill="url(#cl-bid)"/>
    <rect x="160" y="294" width="20" height="66" rx="4" fill="url(#cl-bid)"/>
    <rect x="186" y="276" width="20" height="84" rx="4" fill="url(#cl-bid)"/>
    <rect x="212" y="260" width="20" height="100" rx="4" fill="url(#cl-bid)"/>
    <rect x="238" y="247" width="20" height="113" rx="4" fill="url(#cl-bid)"/>
    <rect x="264" y="242" width="20" height="118" rx="4" fill="url(#cl-bid)"/>
    <rect x="290" y="247" width="20" height="113" rx="4" fill="url(#cl-bid)"/>
    <rect x="316" y="260" width="20" height="100" rx="4" fill="url(#cl-bid)"/>
    <rect x="342" y="280" width="20" height="80" rx="4" fill="url(#cl-bid)"/>
    <rect x="368" y="302" width="20" height="58" rx="4" fill="url(#cl-bid)"/>
    <rect x="394" y="320" width="20" height="40" rx="4" fill="url(#cl-bid)"/>
    <rect x="524" y="260" width="20" height="100" rx="4" fill="url(#cl-ask)"/>
    <rect x="550" y="247" width="20" height="113" rx="4" fill="url(#cl-ask)"/>
    <rect x="576" y="242" width="20" height="118" rx="4" fill="url(#cl-ask)"/>
    <rect x="602" y="247" width="20" height="113" rx="4" fill="url(#cl-ask)"/>
    <rect x="628" y="260" width="20" height="100" rx="4" fill="url(#cl-ask)"/>
    <rect x="654" y="276" width="20" height="84" rx="4" fill="url(#cl-ask)"/>
    <rect x="680" y="294" width="20" height="66" rx="4" fill="url(#cl-ask)"/>
    <rect x="706" y="312" width="20" height="48" rx="4" fill="url(#cl-ask)"/>
    <rect x="732" y="326" width="20" height="34" rx="4" fill="url(#cl-ask)"/>
    <rect x="420" y="360" width="20" height="0" rx="4" fill="url(#cl-bid)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="0;0;0;26;26;26;26;26;26;0;0" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="360;360;360;334;334;334;334;334;334;360;360" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="420" y="360" width="20" height="0" rx="4" fill="url(#cl-ask)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="0;0;0;0;0;0;0;0;0" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="360;360;360;360;360;360;360;360;360" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="446" y="360" width="20" height="0" rx="4" fill="url(#cl-bid)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="0;0;0;0;40;40;40;40;0;0;0" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="360;360;360;360;320;320;320;320;360;360;360" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="446" y="320" width="20" height="40" rx="4" fill="url(#cl-ask)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="40;40;40;0;0;0;0;0;0;40;40" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="320;320;320;360;360;360;360;360;360;320;320" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="472" y="360" width="20" height="0" rx="4" fill="url(#cl-bid)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="0;0;0;0;0;58;58;0;0;0;0" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="360;360;360;360;360;302;302;360;360;360;360" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="472" y="302" width="20" height="58" rx="4" fill="url(#cl-ask)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="58;58;58;58;0;0;0;0;58;58;58" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="302;302;302;302;360;360;360;360;302;302;302" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="498" y="360" width="20" height="0" rx="4" fill="url(#cl-bid)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="0;0;0;0;0;0;0;0;0" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="360;360;360;360;360;360;360;360;360" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
    <rect x="498" y="280" width="20" height="80" rx="4" fill="url(#cl-ask)">
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="80;80;80;80;80;0;0;80;80;80;80" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="280;280;280;280;280;360;360;280;280;280;280" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
  </g>
  
    <g class="fx-cl-mirror">
      <rect x="342" y="200" width="20" height="80" rx="4" fill="url(#cl-gold)" stroke="rgba(240,185,11,0.45)">
        <animate attributeName="x" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="342;342;342;342;342;342;342;342;342" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="80;80;80;80;80;80;80;80;80" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="200;200;200;200;200;200;200;200;200" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
      <rect x="368" y="244" width="20" height="58" rx="4" fill="url(#cl-gold)" stroke="rgba(240,185,11,0.45)">
        <animate attributeName="x" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="368;368;368;368;368;368;368;368;368" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="58;58;58;58;58;58;58;58;58" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="244;244;244;244;244;244;244;244;244" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
      <rect x="394" y="280" width="20" height="40" rx="4" fill="url(#cl-gold)" stroke="rgba(240,185,11,0.45)">
        <animate attributeName="x" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="394;394;394;394;394;394;394;394;394" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="40;40;40;40;40;40;40;40;40" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="280;280;280;280;280;280;280;280;280" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
      <rect x="446" y="280" width="20" height="40" rx="4" fill="url(#cl-gold)" stroke="rgba(240,185,11,0.45)">
        <animate attributeName="x" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="446;446;446;420;420;420;420;420;420;446;446" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="40;40;40;26;26;26;26;26;26;40;40" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.31;0.42;0.58;0.66;0.74;0.82;0.87;1" values="280;280;280;308;308;308;308;308;308;280;280" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
      <rect x="472" y="244" width="20" height="58" rx="4" fill="url(#cl-gold)" stroke="rgba(240,185,11,0.45)">
        <animate attributeName="x" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="472;472;472;472;446;446;446;446;472;472;472" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="58;58;58;58;40;40;40;40;58;58;58" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.47;0.58;0.66;0.74;0.79;0.82;1" values="244;244;244;244;280;280;280;280;244;244;244" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect>
      <rect x="498" y="200" width="20" height="80" rx="4" fill="url(#cl-gold)" stroke="rgba(240,185,11,0.45)">
        <animate attributeName="x" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="498;498;498;498;498;472;472;498;498;498;498" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="height" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="80;80;80;80;80;58;58;80;80;80;80" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
        <animate attributeName="y" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.63;0.66;0.71;0.74;0.82;1" values="200;200;200;200;200;244;244;200;200;200;200" calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1;0.3 0 0.2 1"/>
      </rect></g>
  
    <g class="fx-cl-price">
      <line y1="96" y2="368" stroke="#f0b90b" stroke-width="2" stroke-opacity="0.9">
        <animate attributeName="x1" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="430;430;456;482;508;482;456;430;430" calcMode="discrete"/>
        <animate attributeName="x2" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="430;430;456;482;508;482;456;430;430" calcMode="discrete"/>
      </line>
      <g font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="15" font-weight="700" text-anchor="middle">
        <animateTransform attributeName="transform" type="translate" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.1;0.26;0.42;0.58;0.66;0.74;0.82;1" values="0 0;0 0;26 0;52 0;78 0;52 0;26 0;0 0;0 0" calcMode="discrete"/>
        <rect x="408" y="376" width="44" height="22" rx="5" fill="#0b0e11" stroke="rgba(240,185,11,0.5)"/>
        <text x="430" y="392" fill="#f0b90b"><animate attributeName="opacity" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.10;0.26;0.82;1" values="1;1;0;1;1" calcMode="discrete"/>43¢</text>
        <text x="430" y="392" fill="#f0b90b"><animate attributeName="opacity" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.10;0.26;0.42;0.66;0.74;0.82;1" values="0;0;1;0;1;0;0;0" calcMode="discrete"/>44¢</text>
        <text x="430" y="392" fill="#f0b90b"><animate attributeName="opacity" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.26;0.42;0.58;0.66;0.74;1" values="0;0;1;0;1;0;0" calcMode="discrete"/>45¢</text>
        <text x="430" y="392" fill="#f0b90b"><animate attributeName="opacity" begin="1s" dur="9s" repeatCount="indefinite" keyTimes="0;0.42;0.58;0.66;1" values="0;0;1;0;0" calcMode="discrete"/>46¢</text>
      </g>
    </g>

  <line x1="70" y1="368" x2="700" y2="368" stroke="rgba(230,232,234,0.12)"/>
  <g font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="14" fill="#8a93a0">
    <text x="70" y="392">37¢</text>
    <text x="700" y="392" text-anchor="end">48¢</text>
  </g>
  <text x="385" y="420" text-anchor="middle" fill="#8a93a0" font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="13">when a trade consumes one side, the mirror liquidity rebalances to the other</text>
</svg>
`,
  },
  {
    id: 'sweep',
    eyebrow: 'Settlement',
    title: 'Fill thousands of orders. Everyone gets paid at once.',
    summary:
      'Liquidity is orders stacked from many owners into one book. A market order fills straight up through the stack, and every order it crosses settles together in a single trade.',
    caption:
      "Each owner's proceeds wait at their own address — no bot, no expiry. Filling three orders or three thousand settles the same way.",
    bullets: [
      'Stacked orders from independent owners form one book.',
      'One market order fills everything it touches in a single trade.',
      "Proceeds wait at each owner's address until they claim.",
    ],
    svg: `
<svg class="fx-visual fx-visual--sweep" viewBox="0 0 760 440" role="img" aria-labelledby="fx-sweep-title fx-sweep-desc">
  <title id="fx-sweep-title">Frontier sweep across stacked owner positions</title>
  <desc id="fx-sweep-desc">A taker sweeps the live edge up through range positions stacked from different owners; each owner keeps a claimable fill at their own address, all settled in one update.</desc>
  <rect class="fx-screen" x="1" y="1" width="758" height="438" rx="8"/>
  <g class="fx-axis">
    <text x="70" y="34">STACKED ORDERS</text>
    <text x="500" y="34">CLAIMABLE TO OWNER</text>
    <text x="380" y="414" text-anchor="middle">ONE MARKET ORDER FILLS EVERY OWNER — SETTLED IN ONE TRADE</text>
  </g>
  <line class="fx-price-axis" x1="70" y1="60" x2="70" y2="356"/>
  <g class="fx-stack">
    <g class="fx-owner fx-owner-1">
      <rect class="fx-owner-band" x="72" y="64" width="232" height="72" rx="3"/>
      <text class="fx-owner-tag" x="88" y="105">0x4f2a…b1</text>
    </g>
    <g class="fx-owner fx-owner-2">
      <rect class="fx-owner-band" x="72" y="136" width="232" height="72" rx="3"/>
      <text class="fx-owner-tag" x="88" y="177">0x9c07…3d</text>
    </g>
    <g class="fx-owner fx-owner-3">
      <rect class="fx-owner-band" x="72" y="208" width="232" height="72" rx="3"/>
      <text class="fx-owner-tag" x="88" y="249">0x1be4…7a</text>
    </g>
    <g class="fx-owner fx-owner-4">
      <rect class="fx-owner-band" x="72" y="280" width="232" height="72" rx="3"/>
      <text class="fx-owner-tag" x="88" y="321">0xa3d8…0c</text>
    </g>
  </g>
  <g class="fx-sweep-rise">
    <line class="fx-sweep-edge" x1="72" y1="0" x2="304" y2="0"/>
    <circle class="fx-sweep-dot" cx="72" cy="0" r="8"/>
  </g>
  <text class="fx-sweep-caption" x="188" y="376" text-anchor="middle">MARKET ORDER FILLS UP THE BOOK</text>
  <line class="fx-settle-bus" x1="402" y1="92" x2="402" y2="324"/>
  <text class="fx-settle-tag" x="402" y="78" text-anchor="middle">ONE FILL</text>
  <g class="fx-links">
    <path class="fx-link fx-link-4" d="M304 316H466"/>
    <path class="fx-link fx-link-3" d="M304 244H466"/>
    <path class="fx-link fx-link-2" d="M304 172H466"/>
    <path class="fx-link fx-link-1" d="M304 100H466"/>
  </g>
  <g class="fx-claims">
    <g class="fx-claim fx-claim-4">
      <rect x="466" y="290" width="224" height="52" rx="8"/>
      <text class="fx-claim-addr" x="482" y="312">0xa3d8…0c</text>
      <text class="fx-claim-amt" x="674" y="312" text-anchor="end">+5,210</text>
      <text class="fx-claim-note" x="482" y="331">USDC claimable · no expiry</text>
    </g>
    <g class="fx-claim fx-claim-3">
      <rect x="466" y="218" width="224" height="52" rx="8"/>
      <text class="fx-claim-addr" x="482" y="240">0x1be4…7a</text>
      <text class="fx-claim-amt" x="674" y="240" text-anchor="end">+3,880</text>
      <text class="fx-claim-note" x="482" y="259">USDC claimable · no expiry</text>
    </g>
    <g class="fx-claim fx-claim-2">
      <rect x="466" y="146" width="224" height="52" rx="8"/>
      <text class="fx-claim-addr" x="482" y="168">0x9c07…3d</text>
      <text class="fx-claim-amt" x="674" y="168" text-anchor="end">+6,540</text>
      <text class="fx-claim-note" x="482" y="187">USDC claimable · no expiry</text>
    </g>
    <g class="fx-claim fx-claim-1">
      <rect x="466" y="74" width="224" height="52" rx="8"/>
      <text class="fx-claim-addr" x="482" y="96">0x4f2a…b1</text>
      <text class="fx-claim-amt" x="674" y="96" text-anchor="end">+4,120</text>
      <text class="fx-claim-note" x="482" y="115">USDC claimable · no expiry</text>
    </g>
  </g>
</svg>`,
  },
]

export const getFrontierExplainer = (id: ExplainerId) => {
  const explainer = frontierExplainers.find((item) => item.id === id)
  if (!explainer) throw new Error(`Unknown Frontier explainer: ${id}`)
  return explainer
}
