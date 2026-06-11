import DefaultTheme from 'vitepress/theme'
import './custom.css'
import GasCostTable from './components/GasCostTable.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('GasCostTable', GasCostTable)
  },
}
