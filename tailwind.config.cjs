/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Open Sans", "sans-serif"] },
      fontSize: { base: "12px" },
      colors: {
        primary: {
          DEFAULT: "#3B82F6",
          dark: "#2563EB",
          light: "#60A5FA",
        },
      },
      boxShadow: { soft: "0 4px 20px rgba(0,0,0,0.06)" },
      borderRadius: { "2xl": "1rem" },
    },
  },
  plugins: [],
};
