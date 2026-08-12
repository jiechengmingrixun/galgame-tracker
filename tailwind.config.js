/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sakura: {
          50: '#fff5f7',
          100: '#ffe0e6',
          200: '#ffc2cf',
          300: '#ff99af',
          400: '#ff6b8a',
          500: '#ff446d',
          600: '#e82256',
          700: '#c41649',
          800: '#a31542',
          900: '#89163d',
        },
        lavender: {
          50: '#f7f5ff',
          100: '#efeaff',
          200: '#ddd3ff',
          300: '#c4b0ff',
          400: '#a583ff',
          500: '#8a5bf6',
          600: '#773de8',
          700: '#662ccf',
          800: '#5626a8',
          900: '#482288',
        },
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-slow': 'float 9s ease-in-out infinite',
        'fade-in': 'fadeIn 0.5s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
