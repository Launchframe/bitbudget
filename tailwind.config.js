/**
 * Tailwind v4 (this repo uses `@tailwindcss/postcss` + `@import "tailwindcss"` in app/globals.css)
 * does not load this file unless you add:
 *   @config "../tailwind.config.js";
 * after those imports.
 *
 * Active breakpoints: `@theme { --breakpoint-* }` in app/globals.css (plus default sm–2xl).
 */
module.exports = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './styles/**/*.{css,scss,sass,less,styl}',
    './lib/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
  ],
  safelist: ['outline-none'],
  theme: {
    screens: {
      xs: '380px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      '3xl': '1920px',
    },
  }
}