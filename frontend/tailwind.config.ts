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
            DEFAULT: "#FF1F1F",
            glow: "rgba(255, 31, 31, 0.72)",
            dim: "rgba(255, 31, 31, 0.16)",
          },
          blue: {
            DEFAULT: "#00A3FF",
            glow: "rgba(0, 163, 255, 0.6)",
            dim: "rgba(0, 163, 255, 0.12)",
          },
          // Pure Neutral Metal - Removed ALL Blue Tints
          metal: {
            dark: "#050505",   // Absolute neutral near-black
            panel: "#121212",  // Pure dark grey panel 
            border: "#2A2A2A", // Pure medium grey border
            text: "#A3A3A3"    // Pure light grey text
          },
          status: {
            safe: "#00FF9D",
            warn: "#FFB000",
            dead: "#4B5563",
            upset: "#FF1F1F",
            deviation: "#A855F7",
            prediction: "#00A3FF",
            scheduled: "#FACC15"
          },
          result: {
            winner: "#FFD54A",
            loser: "#7C7F8A",
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
          'text-shadow': '0 0 10px rgba(230, 0, 0, 0.8)',
        },
        '.text-glow-blue': {
          'text-shadow': '0 0 10px rgba(0, 163, 255, 0.8)',
        },
      })
    }
  ],
};
export default config;
