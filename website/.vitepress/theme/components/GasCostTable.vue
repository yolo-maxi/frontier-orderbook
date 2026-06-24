<script setup>
import { ref, computed } from 'vue'

// Editable defaults, not live data. Gas prices drift; token prices drift
// more. The point is the ratio between scenarios and the order of
// magnitude per network — tweak the inputs to match the day you're reading
// this.
const networks = [
  { name: 'Ethereum', gasGwei: 0.5, tokenUsd: 3000, token: 'ETH' },
  { name: 'Base', gasGwei: 0.01, tokenUsd: 3000, token: 'ETH', note: 'execution only — excludes the (post-4844, usually small) L1 data fee' },
  { name: 'Gnosis', gasGwei: 1.0, tokenUsd: 1, token: 'xDAI' },
]

const selected = ref(0)
const gasGwei = ref(networks[0].gasGwei)
const tokenUsd = ref(networks[0].tokenUsd)

function pick(i) {
  selected.value = i
  gasGwei.value = networks[i].gasGwei
  tokenUsd.value = networks[i].tokenUsd
}

const groups = [
  {
    title: 'Takers',
    rows: [
      { label: 'Buy through one ask ladder (20 levels)', gas: 133217 },
      { label: 'Sell into one bid ladder (20 levels)', gas: 133948 },
      { label: 'Sweep crossing 5 distinct maker endpoints', gas: 173689 },
      { label: 'Sweep crossing 50 distinct maker endpoints', gas: 581295 },
      { label: 'Deep ask sweep: one maker, 500 price levels', gas: 149347 },
      { label: 'Deep ask sweep: one maker, 5,000 price levels', gas: 194299 },
      { label: 'Production geometric curve, one maker, 5,000 levels', gas: 177815 },
      { label: 'Deep bid sweep: one maker, 5,000 price levels', gas: 195988 },
      { label: 'Sparse ask sweep: 2 orders across a 100k-tick gap', gas: 1137340 },
    ],
  },
  {
    title: 'Makers',
    rows: [
      { label: 'Place ask ladder (10 levels, one bitmap word)', gas: 183918 },
      { label: 'Place ask ladder (1,000 levels, two bitmap words)', gas: 205830 },
      { label: 'Place bid ladder (10 levels)', gas: 182718 },
      { label: 'Place bid ladder (10,000 levels)', gas: 200432 },
      { label: 'Claim ask fills (witness, width-independent)', gas: 65829 },
      { label: 'Claim ask fills (on-chain frontier scan)', gas: 49607 },
      { label: 'Cancel ask (witness, width-independent)', gas: 87556 },
      { label: 'Cancel ask (on-chain frontier scan)', gas: 67125 },
      { label: 'Claim bid fills (witness, ERC-20 payout)', gas: 51525 },
      { label: 'Cancel bid (witness, refund transfer)', gas: 62661 },
    ],
  },
  {
    title: 'Venue',
    rows: [
      { label: 'Create a whole new geometric market via factory', gas: 8811051 },
      { label: 'Copy-liquidity first deposit', gas: 190095 },
      { label: 'Copy-liquidity pro-rata deposit', gas: 102984 },
      { label: 'Copy-liquidity withdraw', gas: 76345 },
    ],
  },
]

const usd = (gas) => {
  const v = gas * gasGwei.value * 1e-9 * tokenUsd.value
  if (!isFinite(v)) return '—'
  if (v >= 100) return '$' + v.toFixed(0)
  if (v >= 1) return '$' + v.toFixed(2)
  if (v >= 0.01) return '$' + v.toFixed(3)
  return '$' + v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}
const fmt = (n) => n.toLocaleString('en-US')
const native = computed(() => networks[selected.value].token)
const noteText = computed(() => networks[selected.value].note)
</script>

<template>
  <div class="gas-picker">
    <div class="controls">
      <div class="presets">
        <button
          v-for="(n, i) in networks"
          :key="n.name"
          :class="{ active: selected === i }"
          @click="pick(i)"
        >{{ n.name }}</button>
      </div>
      <label>
        gas price
        <input type="number" v-model.number="gasGwei" min="0" step="any" /> gwei
      </label>
      <label>
        {{ native }} price
        $<input type="number" v-model.number="tokenUsd" min="0" step="any" />
      </label>
    </div>
    <p v-if="noteText" class="note">{{ noteText }}</p>

    <table v-for="g in groups" :key="g.title">
      <thead>
        <tr><th>{{ g.title }}</th><th>gas</th><th>cost</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in g.rows" :key="r.label">
          <td>{{ r.label }}</td>
          <td class="num">{{ fmt(r.gas) }}</td>
          <td class="num cost">{{ usd(r.gas) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="note">Defaults are editable ballparks, not live feeds. Mock-token transfers; real ERC-20s add ~10–40k per transfer.</p>
  </div>
</template>

<style scoped>
.gas-picker { margin: 1.5rem 0; }
.controls {
  display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;
  padding: 0.75rem 1rem; border: 1px solid var(--vp-c-divider);
  border-radius: 8px; background: var(--vp-c-bg-soft);
}
.presets { display: flex; gap: 0.5rem; }
.presets button {
  padding: 0.3rem 0.9rem; border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: transparent; color: var(--vp-c-text-2);
  font-size: 0.85rem; cursor: pointer;
}
.presets button.active {
  border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1);
  background: rgba(46, 189, 133, 0.08);
}
.controls label {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.8rem; color: var(--vp-c-text-2);
}
.controls input {
  width: 5.5rem; padding: 0.25rem 0.5rem;
  border: 1px solid var(--vp-c-divider); border-radius: 6px;
  background: var(--vp-c-bg); color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}
.gas-picker table { width: 100%; display: table; margin: 1rem 0 0; }
.gas-picker th:first-child { width: 60%; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.cost { color: var(--vp-c-brand-1); font-weight: 600; }
.note { font-size: 0.8rem; color: var(--vp-c-text-3); margin: 0.5rem 0 0; }
</style>
