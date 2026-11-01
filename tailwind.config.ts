import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07070b",
          900: "#0c0c12",
          800: "#12121a",
          700: "#1a1a25",
          600: "#252533",
        },
        brand: {
          400: "#9b8cff",
          500: "#7c6cf5",
          600: "#6554e0",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
