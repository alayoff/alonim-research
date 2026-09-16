/** @type {import('tailwindcss').Config} */
module.exports = {
  // סורקים את קובץ המקור — לא את index.html הבנוי.
  // סריקה של הפלט תפספס כל קלאס חדש (הוא נבנה רק אחרי שה-CSS כבר קומפל).
  content: ['./src/index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', '"Noto Sans Hebrew"', 'Arial', 'Tahoma', 'sans-serif'],
        display: ['"Segoe UI"', 'system-ui', '-apple-system', '"Noto Sans Hebrew"', 'Arial', 'Tahoma', 'sans-serif'],
        mono: ['ui-monospace', '"Cascadia Mono"', 'Consolas', '"Courier New"', 'monospace'],
      },
      colors: {
        brand: {
          teal: '#0d9488', mint: '#a7f3d0', pink: '#f472b6',
          rose: '#f43f5e', sky: '#0284c7', navy: '#0f172a', lavender: '#8b5cf6'
        }
      },
      animation: {
        'float-slow': 'floatSlow 8s ease-in-out infinite alternate',
        'pulse-subtle': 'pulseSubtle 2.5s ease-in-out infinite',
        'fadeIn': 'fadeIn 0.35s ease-out both',
      },
      keyframes: {
        floatSlow: {
          '0%': { transform: 'translateY(0px) rotate(0deg)' },
          '100%': { transform: 'translateY(-16px) rotate(2deg)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.92', transform: 'scale(1.02)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    }
  },
  plugins: [],
}
