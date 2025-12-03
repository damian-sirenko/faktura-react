import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // ← ОБОВ’ЯЗКОВО! Підключає Tailwind + наші утиліти
import "./styles/print.css";
import "./utils/api.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
