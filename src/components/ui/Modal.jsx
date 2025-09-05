import React from "react";

export default function Modal({
  open,
  title = "Potwierdzenie",
  children,
  confirmText = "Usuń",
  cancelText = "Anuluj",
  onConfirm,
  onClose,
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* dialog */}
      <div
        className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="modal-title" className="text-lg font-semibold mb-2">
          {title}
        </h3>
        <div className="text-sm text-gray-700">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {cancelText}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
