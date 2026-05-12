import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#697386",
        line: "#d9e2ec",
        canvas: "#f6f8fb",
        primary: {
          50: "#eef6ff",
          100: "#dceeff",
          500: "#3a7ca5",
          600: "#2f6688",
          700: "#285573"
        }
      },
      boxShadow: {
        soft: "0 12px 30px rgba(33, 53, 85, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
