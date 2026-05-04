import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Red vs Blue Theme Focus
        background: "var(--background)",
        foreground: "var(--foreground)",
        
        rm: {
          red: {
            DEFAULT: "#E8302A",
            glow: "rgba(232, 48, 42, 0.7)",
            dim: "rgba(232, 48, 42, 0.12)",
          },
          blue: {
            DEFAULT: "#2A9FFF",
            glow: "rgba(42, 159, 255, 0.7)",
            dim: "rgba(42, 159, 255, 0.12)",
          },
          metal: {
            dark: "#09090B",
            raised: "#101012",
            panel: "#16161A",
            card: "#1C1C1F",
            border: "#2A2A2E",
            text: "#A3A3A3",
            textLight: "#EDEDEF",
            textMuted: "#A1A1AA",
            textFaint: "#71717A"
          },
          status: {
            safe: "#00E878",
            warn: "#FFB000",
            dead: "#4B5563",
            upset: "#E8302A",
            deviation: "#A855F7",
            prediction: "#2A9FFF",
            scheduled: "#FACC15",
            confirmed: "#00E878",
            pending: "#FFB000"
          },
          accent: {
            DEFAULT: "#0EA5E9",
            glow: "rgba(14, 165, 233, 0.4)",
            dim: "rgba(14, 165, 233, 0.12)",
          },
          violet: {
            DEFAULT: "#8B5CF6",
            glow: "rgba(139, 92, 246, 0.4)",
            dim: "rgba(139, 92, 246, 0.12)",
          },
          result: {
            winner: "#F0972C",
            winnerGlow: "rgba(240, 151, 44, 0.8)",
            loser: "#7A7C80",
            neutral: "#F5F7FA"
          }
        }
      },
      backgroundImage: {
        'tactical-grid': "linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px)",
        'red-blue-gradient': "linear-gradient(90deg, rgba(230,0,0,0.15) 0%, rgba(0,163,255,0.15) 100%)",
        'red-blue-split': "linear-gradient(135deg, rgba(230,0,0,0.1) 0%, rgba(230,0,0,0) 40%, rgba(0,163,255,0) 60%, rgba(0,163,255,0.1) 100%)"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-roboto-mono)", "monospace"],
        machine: ["var(--font-orbitron)", "sans-serif"],
      },
      clipPath: {
        'chamfer': 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        'chamfer-lg': 'polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px)',
      },
      keyframes: {
        scanlineMove: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        glowBreathe: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(232,48,42,0.08), 0 0 12px rgba(42,159,255,0.06)' },
          '50%': { boxShadow: '0 0 20px rgba(232,48,42,0.15), 0 0 20px rgba(42,159,255,0.12)' },
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgba(42,159,255,0.15)' },
          '50%': { borderColor: 'rgba(42,159,255,0.35)' },
        },
        dotPulse: {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.3)' },
        },
      },
      animation: {
        'scanline': 'scanlineMove 4s linear infinite',
        'glow-breathe': 'glowBreathe 3s ease-in-out infinite',
        'border-glow': 'borderGlow 3s ease-in-out infinite',
        'dot-pulse': 'dotPulse 2s ease-in-out infinite',
      }
    },
  },
  plugins: [
    function (api: any) {
      const { addUtilities } = api;
      addUtilities({
        '.clip-chamfer': {
          'clip-path': 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        },
        '.clip-chamfer-lg': {
          'clip-path': 'polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px)',
        },
        '.clip-chamfer-tr-bl': {
          'clip-path': 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
        },
        '.text-glow-red': {
          'text-shadow': '0 0 10px rgba(232, 48, 42, 0.7)',
        },
        '.text-glow-blue': {
          'text-shadow': '0 0 10px rgba(42, 159, 255, 0.7)',
        },
        '.text-glow-winner': {
          'text-shadow': '0 0 24px rgba(240, 151, 44, 0.8), 0 0 48px rgba(240, 151, 44, 0.3)',
        },
        '.text-glow-violet': {
          'text-shadow': '0 0 10px rgba(139, 92, 246, 0.7)',
        },
        '.glass-panel': {
          'backdrop-filter': 'blur(6px)',
          'background': 'rgba(4, 6, 8, 0.75)',
        },
      })
    }
  ],
};
export default config;
