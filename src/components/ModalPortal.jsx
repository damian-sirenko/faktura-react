// src/components/ModalPortal.jsx
import { createPortal } from "react-dom";

/**
 * Проста обгортка модалки через портал у <body>.
 * Нічого не стилізує—усі стилі/оверлей задаються у вмісті модалки.
 */
export default function ModalPortal({ children }) {
  // Прямо рендеримо в body — цього достатньо для перекриття z-index та pointer-events.
  return createPortal(children, document.body);
}
