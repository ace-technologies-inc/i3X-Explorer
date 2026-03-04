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
          'primary':    'rgb(var(--i3x-primary)    / <alpha-value>)',
          'secondary':  'rgb(var(--i3x-secondary)  / <alpha-value>)',
          'success':    'rgb(var(--i3x-success)    / <alpha-value>)',
          'warning':    'rgb(var(--i3x-warning)    / <alpha-value>)',
          'error':      'rgb(var(--i3x-error)      / <alpha-value>)',
          'bg':         'rgb(var(--i3x-bg)         / <alpha-value>)',
          'surface':    'rgb(var(--i3x-surface)    / <alpha-value>)',
          'border':     'rgb(var(--i3x-border)     / <alpha-value>)',
          'text':       'rgb(var(--i3x-text)       / <alpha-value>)',
          'text-muted': 'rgb(var(--i3x-text-muted) / <alpha-value>)',
        }
      }
    },
  },
  plugins: [],
}
