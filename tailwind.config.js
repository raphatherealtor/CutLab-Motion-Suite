/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        bg: { DEFAULT: 'var(--color-bg)' },
        surface: { DEFAULT: 'var(--color-surface)' },
        elevated: { DEFAULT: 'var(--color-elevated)' },
        well: { DEFAULT: 'var(--color-well)' },
        fg: { DEFAULT: 'var(--color-fg)' },
        muted: { DEFAULT: 'var(--color-muted)' },
        subtle: { DEFAULT: 'var(--color-subtle)' },
        border: { DEFAULT: 'var(--color-border)' },
        accent: {
          DEFAULT: 'var(--color-accent)',
          2: 'var(--color-accent-2)',
          3: 'var(--color-accent-3)',
          fg: 'var(--color-accent-fg)',
        },
        danger: { DEFAULT: 'var(--color-danger)' },
        success: { DEFAULT: 'var(--color-success)' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Courier New', 'monospace'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        sm: 'var(--radius-sm)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};