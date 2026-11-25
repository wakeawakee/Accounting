/** @type {import('tailwindcss').Config} */
// Palette from the subject: ledger ink, Nepal-flag blue for actions, patro/seal crimson reserved for "late".
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Mukta', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef3fc', 100: '#d9e4f8', 200: '#b3c7ef', 500: '#2c56c4', 600: '#2449a8', 700: '#1d3b88' },
        ink: { 700: '#2a3a57', 800: '#1e2c45', 900: '#172338' },
        seal: { 50: '#fdf0f2', 100: '#fadbe0', 500: '#c8102e', 600: '#a50d26' },
        paper: '#f4f6f9',
      },
    },
  },
  plugins: [],
};
