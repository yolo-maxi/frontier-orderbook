<script setup>
// Frontier mark + wordmark. Stepped-F motif: a ladder of price levels
// resolving into an F. Top rung is gold (your touch / the frontier),
// descending rungs go signal-green then deep-green (the book thinning out).
//
// variant: "mark" (square glyph) | "lockup" (glyph + wordmark)
// tone:    "color" (full palette) | "mono" (single currentColor)
// blink:   show the terminal cursor tick (lockup only)
defineProps({
  variant: { type: String, default: 'lockup' }, // mark | lockup
  tone: { type: String, default: 'color' },      // color | mono
  size: { type: [Number, String], default: 48 },
  blink: { type: Boolean, default: true },
})
</script>

<template>
  <!-- Square mark -->
  <svg
    v-if="variant === 'mark'"
    class="fr-mark"
    :class="tone"
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    role="img"
    aria-label="Frontier mark"
  >
    <rect width="64" height="64" rx="12" class="bg" />
    <rect x="14" y="12" width="6" height="40" rx="1" class="spine" />
    <rect x="14" y="12" width="34" height="6" rx="1" class="r-gold" />
    <rect x="14" y="24" width="26" height="6" rx="1" class="r-green" />
    <rect x="14" y="36" width="18" height="6" rx="1" class="r-deep" />
  </svg>

  <!-- Lockup: glyph + mono wordmark -->
  <svg
    v-else
    class="fr-lockup"
    :class="tone"
    :height="size"
    viewBox="0 0 360 64"
    role="img"
    aria-label="FRONTIER"
  >
    <g>
      <rect x="0" y="12" width="6" height="40" rx="1" class="spine" />
      <rect x="0" y="12" width="30" height="6" rx="1" class="r-gold" />
      <rect x="0" y="24" width="23" height="6" rx="1" class="r-green" />
      <rect x="0" y="36" width="16" height="6" rx="1" class="r-deep" />
    </g>
    <text x="46" y="44" class="wm">FRONTIER</text>
    <rect v-if="blink" x="350" y="20" width="6" height="26" class="cursor" />
  </svg>
</template>

<style scoped>
.bg { fill: var(--fr-ink, #0b0e11); }
.spine { fill: var(--fr-bone, #e6e8ea); }
.r-gold { fill: var(--fr-gold, #f0b90b); }
.r-green { fill: var(--fr-green, #2ebd85); }
.r-deep { fill: var(--fr-green-deep, #1ea06d); }
.wm {
  font-family: var(--fr-mono, ui-monospace, monospace);
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 6px;
  fill: var(--fr-bone, #e6e8ea);
}
.cursor { fill: var(--fr-green, #2ebd85); animation: fr-blink 1.1s steps(1) infinite; }

/* mono tone: everything reads in one ink */
.mono .bg { fill: none; }
.mono .spine,
.mono .r-gold,
.mono .r-green,
.mono .r-deep,
.mono .wm,
.mono .cursor { fill: currentColor; }

@keyframes fr-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .cursor { animation: none; }
}
</style>
