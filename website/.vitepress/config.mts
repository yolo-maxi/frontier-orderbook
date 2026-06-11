import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Frontier',
  description: 'The order book is back onchain — a thin-tick CLOB with compressed settlement',
  base: '/docs/',
  appearance: 'force-dark',
  themeConfig: {
    siteTitle: 'FRONTIER · DOCS',
    nav: [
      { text: 'App', link: 'https://clob.repo.box' },
      { text: 'GitHub', link: 'https://github.com/yolo-maxi/frontier-orderbook' },
    ],
    sidebar: [
      { text: 'Overview', link: '/' },
      {
        text: 'Protocol',
        items: [
          { text: 'The Mechanism', link: '/guide/mechanism' },
          { text: 'Architecture', link: '/guide/architecture' },
          { text: 'Delegatable Permissions', link: '/guide/permissions' },
          { text: 'Hooks', link: '/guide/hooks' },
          { text: 'Gas', link: '/guide/gas' },
          { text: 'Ticks & Prices', link: '/guide/pricing' },
          { text: 'Potential Topologies', link: '/guide/topology' },
        ],
      },
      {
        text: 'Experiments',
        items: [
          { text: 'Yield While Quoted', link: '/experiments/yield' },
          { text: 'LP on the Book', link: '/experiments/lp' },
          { text: 'The Uniswap v4 Lineage', link: '/experiments/v4-hook' },
          { text: 'Sub-Tick Fills (parked)', link: '/experiments/partial-fills' },
        ],
      },
      { text: 'Live Demo Guide', link: '/guide/demo' },
      { text: 'Roadmap & Caveats', link: '/roadmap' },
      { text: 'Brand', link: '/brand' },
    ],
    outline: [2, 3],
  },
})
