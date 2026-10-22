import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // El informe HTML de Playwright vive en la raíz del proyecto: cada vez que lo escribe, Vite ve un `.html` nuevo y recarga las
  // páginas abiertas, con las pruebas e2e aún en marcha. No es código de la aplicación.
  server: { watch: { ignored: ["**/playwright-report/**", "**/test-results/**"] } },
  // Declara de antemano las dependencias del cliente para que Vite no tenga que descubrir ninguna tarde (`@letele/playing-cards`
  // se importa en diferido, al abrir una mesa) y, si lo hiciera, volver a optimizar y recargar la página en mitad de una partida
  // o de una prueba e2e con el servidor de desarrollo en frío. Es una precaución: no llegué a reproducir esa recarga con ni sin
  // esta lista.
  optimizeDeps: {
    include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "wouter", "motion/react", "partysocket/react", "qrcode.react", "@letele/playing-cards"],
  },
});
