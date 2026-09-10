/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nas: {
          bg: '#090d16',
          card: '#111827',
          cardHover: '#162032',
          border: '#1f293d',
          accent: '#38bdf8',
          accentHover: '#0ea5e9',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          muted: '#64748b',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
