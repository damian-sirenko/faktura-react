import React from "react";

/* ====== Confirm modal ====== */
export function ConfirmModal({ open, title, message, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-5 w-full max-w-md">
        <div className="text-lg font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-700 mb-4">{message}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            Potwierdź
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== Preview modal ====== */
export function PreviewModal({ open, src, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-5xl h-[80vh] flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-semibold">Podgląd PDF</div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            key={src}
            title="PDF preview"
            src={src}
            className="w-full h-full"
          />
        </div>
      </div>
    </div>
  );
}
