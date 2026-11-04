/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        tier: {
          free: "#34d399",
          reduced: "#f59e0b",
          full: "#9ca3af",
        },
        ink: {
          950: "#0a0a0c",
          900: "#111113",
          800: "#1a1a1d",
        },
      },
      backdropBlur: {
        glass: "24px",
      },
      borderRadius: {
        glass: "20px",
      },
    },
  },
  plugins: [],
};
