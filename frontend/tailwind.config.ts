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
            DEFAULT: "#DC143C",
            glow: "rgba(220, 20, 60, 0.7)",
            dim: "rgba(220, 20, 60, 0.12)",
          },
          blue: {
            DEFAULT: "#1E90FF",
            glow: "rgba(30, 144, 255, 0.7)",
            dim: "rgba(30, 144, 255, 0.12)",
          },
          metal: {
            dark: "#040608",
            panel: "#121212",
            border: "#2A2A2A",
            text: "#A3A3A3"
          },
          status: {
            safe: "#00FF9D",
            warn: "#FFB000",
            dead: "#4B5563",
            upset: "#DC143C",
            deviation: "#A855F7",
            prediction: "#1E90FF",
            scheduled: "#FACC15"
          },
          result: {
            winner: "#FFB553",
            winnerGlow: "rgba(255, 181, 83, 0.6)",
            loser: "#9D9F9F",
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
          'text-shadow': '0 0 10px rgba(220, 20, 60, 0.7)',
        },
        '.text-glow-blue': {
          'text-shadow': '0 0 10px rgba(30, 144, 255, 0.7)',
        },
        '.text-glow-winner': {
          'text-shadow': '0 0 12px rgba(255, 181, 83, 0.7)',
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
