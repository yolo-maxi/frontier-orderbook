<script setup>
// Frontier icon set. Geometric/mono line icons, 2px stroke, currentColor.
// name: ladder | settlement | gas | permission | ticks | hooks | claim | book
// Inline (not <img>) so they inherit color and can animate.
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 32 },
})

const paths = {
  ladder: `<line x1="6" y1="4" x2="6" y2="28"/><line x1="26" y1="4" x2="26" y2="28"/><line x1="6" y1="9" x2="26" y2="9"/><line x1="6" y1="16" x2="26" y2="16"/><line x1="6" y1="23" x2="26" y2="23"/>`,
  settlement: `<path d="M5 12 L16 5 L27 12"/><path d="M5 12 L5 25 L27 25 L27 12"/><path d="M11 25 L11 17 L21 17 L21 25"/><path d="M13 11 L15 13 L19 9"/>`,
  gas: `<rect x="6" y="5" width="13" height="22" rx="2"/><line x1="6" y1="11" x2="19" y2="11"/><path d="M19 14 L23 14 L23 21 a2.5 2.5 0 0 0 5 0 L28 11 L25 8"/>`,
  permission: `<rect x="7" y="14" width="18" height="13" rx="2"/><path d="M11 14 L11 10 a5 5 0 0 1 10 0 L21 14"/><circle cx="16" cy="20" r="1.6" fill="currentColor" stroke="none"/><line x1="16" y1="21.5" x2="16" y2="24"/>`,
  ticks: `<line x1="4" y1="24" x2="28" y2="24"/><line x1="7" y1="24" x2="7" y2="14"/><line x1="12" y1="24" x2="12" y2="19"/><line x1="17" y1="24" x2="17" y2="10"/><line x1="22" y1="24" x2="22" y2="19"/><line x1="27" y1="24" x2="27" y2="16"/>`,
  hooks: `<path d="M11 5 L11 17 a6 6 0 0 0 12 0 L23 13"/><circle cx="11" cy="5" r="2.5"/><path d="M19 13 L23 13 L23 9"/>`,
  claim: `<path d="M16 4 L16 21"/><path d="M10 15 L16 21 L22 15"/><path d="M6 24 L6 27 L26 27 L26 24"/>`,
  book: `<line x1="16" y1="6" x2="16" y2="26"/><rect x="6" y="9" width="7" height="4"/><rect x="6" y="15" width="5" height="4"/><rect x="19" y="13" width="7" height="4"/><rect x="19" y="19" width="5" height="4"/>`,
}
</script>

<template>
  <svg
    class="fr-icon"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :aria-label="name"
    role="img"
    v-html="paths[name] || ''"
  />
</template>

<style scoped>
.fr-icon { display: inline-block; vertical-align: middle; }
</style>
