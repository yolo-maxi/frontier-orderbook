<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'

// Animated order-book depth motif. A living bid/ask ladder around a
// frontier (the touch). Bids fade green, asks fade red, the spread glows
// gold. A taker periodically sweeps the book — a fill-flash ripples across
// the levels. Honors prefers-reduced-motion with a static, fully-rendered
// fallback (same DOM, no timers).

const LEVELS = 11 // per side
const reduced = ref(false)
let timer = null
let raf = null

// Each level: a depth magnitude that drifts. Static defaults render a
// believable book even with JS disabled / SSR.
function seedDepth(i) {
  // Deeper away from the touch, with a little shape.
  const base = 0.32 + i * 0.06
  const wobble = Math.sin(i * 1.3) * 0.08
  return Math.min(1, Math.max(0.18, base + wobble))
}
const bids = ref(Array.from({ length: LEVELS }, (_, i) => seedDepth(i)))
const asks = ref(Array.from({ length: LEVELS }, (_, i) => seedDepth(i)))
const flashBid = ref(-1) // index currently flashing on the bid side
const flashAsk = ref(-1)
const mid = ref(1652.30)

// price labels, finest-tick grid: $0.001 steps shown coarsely as $0.05
const askPrices = computed(() =>
  asks.value.map((_, i) => (mid.value + 0.05 + i * 0.05).toFixed(2))
)
const bidPrices = computed(() =>
  bids.value.map((_, i) => (mid.value - 0.05 - i * 0.05).toFixed(2))
)

function tickDrift() {
  // gentle organic drift so it feels alive
  for (let i = 0; i < LEVELS; i++) {
    bids.value[i] = clamp(bids.value[i] + (Math.random() - 0.5) * 0.07)
    asks.value[i] = clamp(asks.value[i] + (Math.random() - 0.5) * 0.07)
  }
  bids.value = [...bids.value]
  asks.value = [...asks.value]
}
const clamp = (v) => Math.min(1, Math.max(0.15, v))

function sweep() {
  // A taker sweeps one side: levels fill from the touch outward, flash gold,
  // then the side replenishes. Demonstrates "fills wait for you".
  const side = Math.random() > 0.5 ? 'ask' : 'bid'
  const depthN = 2 + Math.floor(Math.random() * 4)
  let step = 0
  const arr = side === 'ask' ? asks : bids
  const flash = side === 'ask' ? flashAsk : flashBid
  const ripple = () => {
    if (step < depthN) {
      flash.value = step
      arr.value[step] = clamp(arr.value[step] - 0.22)
      arr.value = [...arr.value]
      step++
      raf = setTimeout(ripple, 70)
    } else {
      flash.value = -1
      mid.value = +(mid.value + (side === 'ask' ? 0.03 : -0.03)).toFixed(2)
      // replenish over the next drift cycles naturally
    }
  }
  ripple()
}

onMounted(() => {
  reduced.value =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced.value) return
  timer = setInterval(() => {
    tickDrift()
    if (Math.random() > 0.55) sweep()
  }, 1400)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (raf) clearTimeout(raf)
})
</script>

<template>
  <div class="depth-hero" :class="{ static: reduced }" aria-hidden="true">
    <div class="grid-glow"></div>
    <div class="book">
      <!-- asks, descending toward the touch -->
      <div class="side asks">
        <div
          v-for="(d, i) in [...asks].reverse()"
          :key="'a' + i"
          class="row"
          :class="{ flash: flashAsk === asks.length - 1 - i }"
        >
          <span class="px">{{ askPrices[asks.length - 1 - i] }}</span>
          <span class="bar ask" :style="{ width: (d * 100) + '%' }"></span>
        </div>
      </div>
      <!-- the frontier: the live touch -->
      <div class="touch">
        <span class="spread-label">THE FRONTIER</span>
        <span class="mid">{{ mid.toFixed(2) }}</span>
        <span class="tick-cursor"></span>
      </div>
      <!-- bids, descending away from the touch -->
      <div class="side bids">
        <div
          v-for="(d, i) in bids"
          :key="'b' + i"
          class="row"
          :class="{ flash: flashBid === i }"
        >
          <span class="px">{{ bidPrices[i] }}</span>
          <span class="bar bid" :style="{ width: (d * 100) + '%' }"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.depth-hero {
  position: relative;
  width: 100%;
  max-width: 420px;
  margin-inline: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background:
    linear-gradient(180deg, var(--fr-ink-2) 0%, var(--fr-ink) 100%);
  padding: 14px 16px;
  overflow: hidden;
  box-\73 hadow: 0 0 0 1px rgba(46, 189, 133, 0.04),
    0 24px 60px -28px rgba(46, 189, 133, 0.35);
}
.grid-glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 60% at 50% 50%, rgba(240, 185, 11, 0.10), transparent 60%);
  pointer-events: none;
}
.book { position: relative; }
.side { display: flex; flex-direction: column; gap: 3px; }
.row {
  position: relative;
  display: flex;
  align-items: center;
  height: 16px;
  font-family: var(--fr-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.66rem;
}
.px {
  width: 56px;
  flex: none;
  color: var(--fr-dim);
  z-index: 2;
}
.bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.bar.bid {
  background: linear-gradient(90deg, var(--fr-depth-bid-0), var(--fr-depth-bid-1));
}
.bar.ask {
  background: linear-gradient(90deg, var(--fr-depth-ask-0), var(--fr-depth-ask-1));
}
.row.flash::after {
  content: "";
  position: absolute;
  inset: -1px -2px;
  border-radius: 4px;
  background: var(--fr-fill-flash);
  animation: fill-flash 0.5s ease-out;
  pointer-events: none;
  z-index: 1;
}
.touch {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  margin: 5px 0;
  padding: 0 4px;
  border-top: 1px solid rgba(240, 185, 11, 0.35);
  border-bottom: 1px solid rgba(240, 185, 11, 0.35);
  background: linear-gradient(90deg, rgba(240, 185, 11, 0.08), transparent);
}
.spread-label {
  font-family: var(--fr-mono);
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  color: var(--fr-gold);
}
.mid {
  margin-left: auto;
  font-family: var(--fr-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--fr-bone);
  font-size: 0.82rem;
}
.tick-cursor {
  width: 6px;
  height: 14px;
  background: var(--fr-green);
  animation: fr-blink 1.1s steps(1) infinite;
}
@keyframes fill-flash {
  from { opacity: 0.9; }
  to { opacity: 0; }
}
@keyframes fr-blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}
.static .tick-cursor { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .tick-cursor { animation: none; }
  .bar { transition: none; }
}
</style>
