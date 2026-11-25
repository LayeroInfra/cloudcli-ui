/**
 * Layero neutral scale for the legacy `gray-*` / `slate-*` / `zinc-*` /
 * `neutral-*` utilities that are hard-coded across ~1,100 call sites.
 *
 * The light end is the Layero design-system "vellum" (warm off-whites and
 * the #dedcd1 border), the dark end is its refined zinc surfaces (#1e1e22
 * card, #131316 page). The scale is static rather than theme-flipping on
 * purpose: the app already pairs every light shade with an explicit `dark:`
 * shade, so remapping the values is enough to put both themes on-brand
 * without touching each call site.
 */
const LAYERO_GRAY = {
  50: '#fafaf7',
  100: '#f3f1ea',
  200: '#e9e7dd',
  300: '#dedcd1',
  400: '#9c9a92',
  500: '#73726c',
  600: '#52514c',
  700: '#3a3a40',
  800: '#1e1e22',
  900: '#141416',
  950: '#0e0e10',
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        serif: ['Merriweather', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      letterSpacing: {
        tightish: '-0.02em',
      },
      colors: {
        gray: LAYERO_GRAY,
        slate: LAYERO_GRAY,
        zinc: LAYERO_GRAY,
        neutral: LAYERO_GRAY,
        leaf: "hsl(var(--leaf))",
        "border-soft": "hsl(var(--border-soft))",
        "border-strong": "hsl(var(--border-strong))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
      },
      keyframes: {
        // Layero design-system entrance: a short rise with a soft ease-out.
        'layero-rise': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'dialog-overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'bottom-sheet-content-show': {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'auth-rise': 'layero-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 2s linear infinite',
        'dialog-overlay-show': 'dialog-overlay-show 150ms ease-out',
        'dialog-content-show': 'dialog-content-show 150ms ease-out',
        'bottom-sheet-content-show': 'bottom-sheet-content-show 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
