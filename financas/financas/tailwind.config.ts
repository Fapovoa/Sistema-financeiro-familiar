import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          500: "#4A6CF7",
          600: "#3B5BEF",
          700: "#2F49D1",
        },
        surface: "#F7F8FC",
        ink: {
          900: "#0F172A",
          700: "#334155",
          500: "#64748B",
          300: "#CBD5E1",
        },
        success: { bg: "#E8F9EF", fg: "#16A34A" },
        danger: { bg: "#FDECEC", fg: "#DC2626" },
        warn: { bg: "#FFF7E6", fg: "#D97706" },
      },
      borderRadius: { xl2: "1rem" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
