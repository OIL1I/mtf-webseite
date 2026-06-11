import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base './' sorgt dafür, dass die Seite auch unter einem GitHub-Pages-Unterpfad
// (https://name.github.io/repo/) funktioniert – Routing läuft über den Hash.
export default defineConfig({
  plugins: [svelte()],
  base: './',
});
