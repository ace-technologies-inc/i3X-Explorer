/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'i3x': {
          'primary': '#3b82f6',
          'secondary': '#64748b',
          'success': '#22c55e',
          'warning': '#f59e0b',
          'error': '#ef4444',
          'bg': '#1e1e1e',
          'surface': '#252526',
          'border': '#3c3c3c',
          'text': '#cccccc',
          'text-muted': '#808080'
        }
      }
    },
  },
  plugins: [],
}
