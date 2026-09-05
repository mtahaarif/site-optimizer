import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    // Ultra-sharp: every `rounded*` utility collapses to a square corner, so the
    // minimalist geometry holds without touching every component's markup.
    borderRadius: {
      none: '0',
      sm: '0',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '0',
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        ground: 'rgb(var(--ground) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        blocker: 'rgb(var(--blocker) / <alpha-value>)',
        critical: 'rgb(var(--critical) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        opportunity: 'rgb(var(--opportunity) / <alpha-value>)',
        notice: 'rgb(var(--notice) / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config;
