// src/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import vue3PhotoPreview from 'vue3-photo-preview'
import 'vue3-photo-preview/dist/index.css'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(vue3PhotoPreview)
app.mount('#app')
