<script setup>
import DefaultTheme from 'vitepress/theme'
import DepthHero from './components/DepthHero.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <!-- the animated order-book depth motif rides in the hero image slot -->
    <template #home-hero-image>
      <DepthHero />
    </template>
  </Layout>
</template>
