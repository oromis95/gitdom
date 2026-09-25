import './assets/main.css'
import './assets/workflow.css'
import './assets/theme.css'
import './assets/studio.css'
import './assets/motion.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './settings'
import App from './App'
import './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
