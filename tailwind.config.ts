import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Syne'", "sans-serif"],
        body: ["'DM Sans'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      colors: {
        night: "#080A0F",
        surface: "#0E1117",
        panel: "#12161F",
        border: "#1E2433",
        muted: "#2A3147",
        accent: {
          asr: "#00D4AA",
          gen: "#7B6FF0",
          tts: "#FF6B6B",
        },
        text: {
          primary: "#E8EBF0",
          secondary: "#7A8499",
          dim: "#3D4559",
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "wave": "wave 1.2s ease-in-out infinite",
        "flow": "flow 3s ease-in-out infinite",
        "glow-asr": "glow-asr 2s ease-in-out infinite",
        "glow-gen": "glow-gen 2s ease-in-out infinite",
        "glow-tts": "glow-tts 2s ease-in-out infinite",
        "slide-up": "slide-up 0.4s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "spin-slow": "spin 3s linear infinite",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.15)", opacity: "0.7" },
        },
        wave: {
          "0%, 100%": { height: "8px" },
          "50%": { height: "32px" },
        },
        flow: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "glow-asr": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 212, 170, 0.15)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 212, 170, 0.35)" },
        },
        "glow-gen": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(123, 111, 240, 0.15)" },
          "50%": { boxShadow: "0 0 40px rgba(123, 111, 240, 0.35)" },
        },
        "glow-tts": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(255, 107, 107, 0.15)" },
          "50%": { boxShadow: "0 0 40px rgba(255, 107, 107, 0.35)" },
        },
        "slide-up": {
          from: { transform: "translateY(12px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
