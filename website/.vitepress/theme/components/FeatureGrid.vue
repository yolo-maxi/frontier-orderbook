<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import FrIcon from './FrIcon.vue'

// Modular feature cards with scroll-in motion and accent styling.
// Each card carries a Frontier icon, an accent (green/gold/red/cyan), and an
// optional link. Motion is information: cards rise + fade as they enter
// the viewport, staggered. Reduced-motion users get them fully visible.
//
// `only` selects a named set: omit it for the landing's protocol features, or
// pass `only="build"` for the developer/ecosystem set used on /guide/build.

const props = defineProps({ only: { type: String, default: '' } })

// the ecosystem/developer set — cyan is the venue/system voice (code, infra)
const buildFeatures = [
  {
    icon: 'book', accent: 'cyan',
    title: 'Typed SDK',
    body: 'Every contract as an `as const` ABI for full viem inference, plus MarketCreator / MakerAgent / TakerAgent helpers that quote, apply slippage, and submit in one call.',
  },
  {
    icon: 'hooks', accent: 'cyan',
    title: 'MCP server',
    body: 'The market, maker, taker, position, and lens surface as Model Context Protocol tools — describe, simulate, execute. Hand any MCP agent the venue.',
  },
  {
    icon: 'settlement', accent: 'cyan',
    title: 'Indexer + API',
    body: 'REST + WebSocket over normalized chain state: markets, positions, the trade tape, stats, OHLC candles, depth. One SQLite file, no external infra.',
  },
  {
    icon: 'claim', accent: 'cyan',
    title: 'Agent skill',
    body: 'A drop-in operating guide that teaches an agent to route intents to calls and apply the guardrails on every write. Payouts only ever go to the owner.',
  },
]

const protocolFeatures = [
  {
    icon: 'ticks', accent: 'green',
    title: 'Basis-point ticks',
    body: 'Production books use the 1.0001^tick curve. The gas bill scales with endpoints and bitmap words, not every price level.',
    link: '/guide/gas', linkText: 'See the numbers',
  },
  {
    icon: 'ladder', accent: 'gold',
    title: 'Ladders, not orders',
    body: 'Quote a whole price range in one transaction — flat or weighted toward the touch. A market maker’s whole curve, placed like a single order.',
  },
  {
    icon: 'claim', accent: 'green',
    title: 'Your fills wait for you',
    body: 'When the market trades through your prices, the proceeds are yours — onchain, accruing, claimable whenever. Nothing expires. No keeper.',
  },
  {
    icon: 'permission', accent: 'gold',
    title: 'Bots without custody',
    body: 'Hand a bot the keys to your quotes, never your coins. Grants are per-action and expirable, payouts only ever go to you.',
  },
  {
    icon: 'gas', accent: 'green',
    title: 'Price it before you send it',
    body: 'Every operation benchmarked as a real transaction, priced in dollars on Ethereum, Base, or Gnosis. A market order on an L2 costs less than the dust you’d ignore on the floor.',
    link: '/guide/gas', linkText: 'Price it on your chain',
  },
  {
    icon: 'hooks', accent: 'green',
    title: 'Books that do things',
    body: 'v4-style hooks turn any book into its own TWAP oracle, a gated market, a circuit-breaker venue, or a rewards program. Implemented and tested.',
    link: '/guide/hooks', linkText: 'See the experiments',
  },
]

const features = computed(() =>
  props.only === 'build' ? buildFeatures : protocolFeatures
)

const root = ref(null)
let io = null

onMounted(() => {
  const reduced =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cards = root.value?.querySelectorAll('.fcard') || []
  if (reduced || !('IntersectionObserver' in window)) {
    cards.forEach((c) => c.classList.add('in'))
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      })
    },
    { threshold: 0.18 }
  )
  cards.forEach((c) => io.observe(c))
})
onUnmounted(() => io && io.disconnect())
</script>

<template>
  <div class="fgrid" ref="root">
    <component
      :is="f.link ? 'a' : 'div'"
      v-for="(f, i) in features"
      :key="f.title"
      class="fcard"
      :class="'accent-' + f.accent"
      :href="f.link"
      :style="{ '--d': i * 70 + 'ms' }"
    >
      <span class="fc-icon"><FrIcon :name="f.icon" :size="26" /></span>
      <h3 class="fc-title">{{ f.title }}</h3>
      <p class="fc-body">{{ f.body }}</p>
      <span v-if="f.link" class="fc-link">{{ f.linkText }} →</span>
    </component>
  </div>
</template>

<style scoped>
.fgrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin: 1.6rem 0 0.4rem;
}
.fcard {
  display: block;
  position: relative;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--fr-ink-2);
  padding: 20px 20px 22px;
  text-decoration: none;
  color: var(--fr-bone);
  overflow: hidden;
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 0.55s ease var(--d, 0ms),
    transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) var(--d, 0ms),
    border-color 0.25s ease;
}
.fcard.in { opacity: 1; transform: none; }
/* accent rail on the left edge */
.fcard::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--rail);
  opacity: 0.65;
  transition: opacity 0.25s ease, width 0.25s ease;
}
.fcard:hover::before { opacity: 1; width: 4px; }
.accent-green { --rail: var(--fr-green); }
.accent-gold { --rail: var(--fr-gold); }
.accent-red { --rail: var(--fr-red); }
.accent-cyan { --rail: var(--fr-cyan); }
a.fcard:hover { border-color: var(--rail); }
.fc-icon {
  display: inline-flex;
  width: 44px; height: 44px;
  align-items: center; justify-content: center;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  background: var(--fr-ink-3);
  color: var(--rail);
  margin-bottom: 14px;
}
.fc-title {
  font-family: var(--fr-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.82rem;
  margin: 0 0 8px;
  border: 0;
  padding: 0;
}
.fc-body {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--fr-dim);
  margin: 0;
  max-width: 46ch;
}
.fc-link {
  display: inline-block;
  margin-top: 12px;
  font-family: var(--fr-mono);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  color: var(--rail);
}
@media (prefers-reduced-motion: reduce) {
  .fcard { transition: border-color 0.25s ease; opacity: 1; transform: none; }
}
</style>
