import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, 'src');

export default defineConfig({
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    resolve: {
        alias: { '@': src },
        dedupe: ['react', 'react-dom'],
    },
    server: {
        port: 1420,
        strictPort: true,
        watch: { ignored: ['**/src-tauri/**'] },
    },
    build: { target: 'safari15', outDir: 'dist', emptyOutDir: true },
});
