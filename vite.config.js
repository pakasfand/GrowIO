import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client', // if your client code lives in /client
  publicDir: '../public',
  build: {
    outDir: '../dist', // where Vite should output built files
    emptyOutDir: true,
  },
});
