import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind({
    // Apply Tailwind reset (preflight). Set to false if you have your own reset.
    config: { applyBaseStyles: true }
  })],
});
