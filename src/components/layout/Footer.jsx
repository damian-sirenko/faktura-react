import React from "react";

export default function Footer() {
  return (
    <footer className="bg-blue-600 border-t border-blue-700 w-full mt-[50px]">
      <div className="w-full px-4 py-3 text-center text-xs text-white">
        © {new Date().getFullYear()} Faktura Serwis. Wszystkie prawa
        zastrzeżone.
      </div>
    </footer>
  );
}
