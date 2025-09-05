import React from "react";

export default function Footer() {
  return (
    <footer className="bg-gray-100 border-t mt-8">
      <div className="max-w-6xl mx-auto px-4 py-3 text-center text-xs text-gray-600">
        © {new Date().getFullYear()} Faktura Serwis. Wszystkie prawa
        zastrzeżone.
      </div>
    </footer>
  );
}
