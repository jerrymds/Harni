/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ag: {
          // Antigravity Dynamic Theme Variables (Supporting opacity / alpha modifiers)
          void: 'rgb(var(--ag-void-rgb) / <alpha-value>)',
          bg: 'rgb(var(--ag-bg-rgb) / <alpha-value>)',
          sidebar: 'rgb(var(--ag-sidebar-rgb) / <alpha-value>)',
          panel: 'rgb(var(--ag-panel-rgb) / <alpha-value>)',
          surface: 'rgb(var(--ag-surface-rgb) / <alpha-value>)',
          elevated: 'rgb(var(--ag-elevated-rgb) / <alpha-value>)',
          border: 'rgb(var(--ag-border-rgb) / <alpha-value>)',
          borderHover: 'rgb(var(--ag-border-hover-rgb) / <alpha-value>)',
          primary: 'rgb(var(--ag-primary-rgb) / <alpha-value>)',
          primaryLight: 'rgb(var(--ag-primary-rgb) / 0.15)',
          primaryGlow: 'var(--ag-primary-glow)',
          // Theme accents (Soft, low-saturation eye-friendly palette)
          purple: '#8B7FD9',
          purpleLight: '#8B7FD926',
          blue: '#60A5FA',
          blueLight: '#60A5FA26',
          green: '#6EE7B7',
          greenLight: '#6EE7B726',
          yellow: '#FDE047',
          yellowLight: '#FDE04726',
          cyan: 'rgb(var(--ag-primary-rgb) / <alpha-value>)',
          cyanGlow: 'var(--ag-primary-glow)',
          amber: '#FDE047',
          coral: '#f87171',
          emerald: '#6EE7B7',
          rose: '#f87171',
          // Text
          textPrimary: 'var(--ag-text-primary, #334155)',
          textSecondary: 'var(--ag-text-secondary, #64748b)',
          textMuted: 'var(--ag-text-muted, #94a3b8)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"Fira Code"', 'JetBrains Mono', 'Consolas', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'soft': '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        'card': '0 2px 8px -2px rgba(15, 23, 42, 0.06), 0 1px 3px 0 rgba(15, 23, 42, 0.04)',
        'glow-primary': 'var(--ag-shadow-glow, 0 2px 10px -1px rgba(96, 165, 250, 0.25))',
        'glow-purple': '0 2px 10px -1px rgba(139, 127, 217, 0.25)',
        'glow-cyan': '0 2px 10px -1px rgba(96, 165, 250, 0.25)',
        'glow-coral': '0 2px 10px -1px rgba(253, 224, 71, 0.25)',
      },
    },
  },
  plugins: [],
}
