import React from "react";

export default function Footer() {
  return (
    <footer className="bg-blue-600 border-t border-blue-700 mt-8 w-full">
      <div className="w-full px-4 py-3 text-center text-xs text-white">
        © {new Date().getFullYear()} Faktura Serwis. Wszystkie prawa
        zastrzeżone.
      </div>
    </footer>
  );
}
