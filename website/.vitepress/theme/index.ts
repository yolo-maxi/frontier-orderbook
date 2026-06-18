import DefaultTheme from 'vitepress/theme'
import './custom.css'
import Layout from './Layout.vue'
import GasCostTable from './components/GasCostTable.vue'
import DepthHero from './components/DepthHero.vue'
import FeatureGrid from './components/FeatureGrid.vue'
import FrIcon from './components/FrIcon.vue'
import FrMark from './components/FrMark.vue'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('GasCostTable', GasCostTable)
    app.component('DepthHero', DepthHero)
    app.component('FeatureGrid', FeatureGrid)
    app.component('FrIcon', FrIcon)
    app.component('FrMark', FrMark)
  },
}
