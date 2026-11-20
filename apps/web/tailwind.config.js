/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans"', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'] },
      colors: { brand: { 50: '#eef7f4', 100: '#d5ece4', 500: '#1f8a6b', 600: '#17735a', 700: '#125c48' } },
    },
  },
  plugins: [],
};
