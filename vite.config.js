import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed.html'),
        sw: resolve(__dirname, 'src/sw.js')
      },
      output: {
        entryFileNames: (assetInfo) => {
          if (assetInfo.name === 'sw') {
            return 'sw.js';
          }
          return 'assets/[name]-[hash].js';
        }
      }
    }
  },
  plugins: [
    {
      name: 'strip-html-comments',
      enforce: 'post',
      transformIndexHtml(html) {
        // Strip HTML comments during build
        return html.replace(/<!--[\s\S]*?-->/g, '');
      }
    }
  ]
});
