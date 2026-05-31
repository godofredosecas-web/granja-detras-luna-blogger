/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './app.js'],
  safelist: [
    'object-[72%_38%]',
    'brightness-110',
    'saturate-110',
    'bg-gradient-to-l',
    'to-charcoal/25',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Georgia', 'Times New Roman', 'serif'],
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        earth: { DEFAULT: '#4A3F35', light: '#6B5A4E', dark: '#2E2620' },
        forest: { DEFAULT: '#2F4535', deep: '#1A2B22', mist: '#4A6356' },
        sand: { DEFAULT: '#D9CEB8', warm: '#F0E8DA', dark: '#B8A88E' },
        charcoal: '#141210',
        moon: { DEFAULT: '#C9A962', light: '#E2C98A', pale: '#F5E6C8' },
      },
      backgroundImage: {
        'hero-gradient':
          'linear-gradient(115deg, rgba(20,18,16,0.68) 0%, rgba(26,43,34,0.42) 38%, rgba(20,18,16,0.22) 62%, rgba(20,18,16,0.08) 100%)',
        'card-shine':
          'linear-gradient(180deg, transparent 40%, rgba(20,18,16,0.85) 100%)',
      },
      transitionDuration: {
        400: '400ms',
      },
    },
  },
  plugins: [],
};
