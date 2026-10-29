import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 中日英共用一套字形：Noto Sans 负责拉丁与等宽数字，Noto Sans SC 负责简中与假名。
import '@fontsource-variable/noto-sans'
import '@fontsource-variable/noto-sans-sc'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
