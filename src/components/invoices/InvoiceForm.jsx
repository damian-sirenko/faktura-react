import React from "react";

/* Локальні хелпери тільки для UI підрахунків/вигляду */
const to2 = (x) => Number(x || 0).toFixed(2);
const plusDaysISO = (baseISO, days) => {
  const d = baseISO ? new Date(baseISO) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const effectiveStatusOf = (inv) => {
  const stored = String(inv?.status || "issued");
  if (stored === "paid") return "paid";
  const due = String(inv?.dueDate || "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (due && due < today) return "overdue";
  return stored;
};

export default function InvoiceForm({
  open,
  form,
  setForm,
  formRef,
  onSave,
  onCancel,
  clientNames,
  servicesDict,
  servicesCatalog,
  suggestNextNumber,
}) {
  if (!open) return null;

  /* Локальні хендлери елементів позицій */
  const updateItemField = (idx, key, val) =>
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, items };
    });

  const updateItemNameAndAutofill = (idx, name) => {
    setForm((f) => {
      const items = [...f.items];
      const current = { ...items[idx], name };
      const rec = servicesCatalog[String(name || "").trim()];
      if (rec) {
        current.price_gross = Number(rec.price_gross || 0);
        current.vat_rate = Number(rec.vat_rate || 23);
      }
      items[idx] = current;
      return { ...f, items };
    });
  };

  const addItemRow = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
    }));

  const removeItemRow = (idx) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const onFormKeyDown = (e) => {
    if (e.key === "Enter") e.preventDefault();
  };

  /* Обробники для NIP/PESEL (взаємовиключні) */
  const onChangeNip = (v) =>
    setForm((f) => ({
      ...f,
      buyer_nip: v,
      buyer_pesel: v ? "" : f.buyer_pesel,
    }));
  const onChangePesel = (v) =>
    setForm((f) => ({
      ...f,
      buyer_pesel: v,
      buyer_nip: v ? "" : f.buyer_nip,
    }));

  /* Підсумки для відображення */
  const totals = (form.items || []).reduce(
    (a, it) => {
      const q = Number(it.qty || 0);
      const gU = Number(it.price_gross || 0);
      const v = Number(it.vat_rate || 23);
      const nU = gU / (1 + v / 100);
      a.gross += gU * q;
      a.net += nU * q;
      return a;
    },
    { net: 0, gross: 0 }
  );
  const vat = totals.gross - totals.net;

  return (
    <div ref={formRef} className="card-lg" onKeyDown={onFormKeyDown}>
      <div className="grid md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Numer *</label>
          <input
            className="input w-full"
            value={form.number}
            onChange={(e) => setForm({ ...form, number: e.target.value })}
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Klient *</label>
          <input
            className="input w-full"
            list="clients-list"
            value={form.client}
            onChange={(e) =>
              // Батько вже підміняє handleClientChange, якщо треба — можна просто setForm
              setForm((f) => ({ ...f, client: e.target.value }))
            }
            required
            placeholder="Zacznij pisać, aby wybrać..."
          />
          <datalist id="clients-list">
            {clientNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-sm mb-1">NIP</label>
          <input
            className="input w-full"
            value={form.buyer_nip}
            onChange={(e) => onChangeNip(e.target.value)}
            disabled={!!form.buyer_pesel}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">PESEL</label>
          <input
            className="input w-full"
            value={form.buyer_pesel}
            onChange={(e) => onChangePesel(e.target.value)}
            disabled={!!form.buyer_nip}
          />
        </div>

        {/* Адреса */}
        <div>
          <label className="block text-sm mb-1">Kod pocztowy</label>
          <input
            className="input w-full"
            placeholder="31-875"
            value={form.buyer_postal}
            onChange={(e) =>
              setForm((f) => ({ ...f, buyer_postal: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Miasto</label>
          <input
            className="input w-full"
            placeholder="Kraków"
            value={form.buyer_city}
            onChange={(e) =>
              setForm((f) => ({ ...f, buyer_city: e.target.value }))
            }
          />
        </div>
        <div className="md:col-span-4">
          <label className="block text-sm mb-1">Ulica</label>
          <input
            className="input w-full"
            placeholder="Ulica 1/2"
            value={form.buyer_street}
            onChange={(e) =>
              setForm((f) => ({ ...f, buyer_street: e.target.value }))
            }
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Data wystawienia *</label>
          <input
            type="date"
            className="input w-full"
            value={form.issueDate}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({
                ...f,
                issueDate: v,
                dueDate: f.dueDate || plusDaysISO(v, 7),
                number:
                  f.number ||
                  (suggestNextNumber ? suggestNextNumber(v) : f.number),
              }));
            }}
            required
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Termin płatności *</label>
          <input
            type="date"
            className="input w-full"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Status</label>
          <select
            className={`input w-40 text-center font-medium rounded-md border ${
              effectiveStatusOf(form) === "paid"
                ? "bg-green-100 text-green-800 border-green-200"
                : effectiveStatusOf(form) === "overdue"
                ? "bg-rose-100 text-rose-800 border-rose-200"
                : "bg-amber-100 text-amber-900 border-amber-200"
            }`}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="issued">wystawiona</option>
            <option value="paid">opłacona</option>
            <option value="overdue">przeterminowana</option>
          </select>
        </div>
      </div>

      {/* Pozycje */}
      <div className="mt-4">
        <div className="font-normal text-sm mb-2">
          Pozycje (wszystkie pola wymagane)
        </div>

        <div className="overflow-x-auto">
          <table className="table w-full table-fixed">
            <colgroup>
              <col style={{ width: "58%" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "14ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "8ch" }} />
            </colgroup>

            <thead>
              <tr className="text-xs font-normal">
                <th className="text-left">Nazwa towaru / usługi *</th>
                <th className="text-center">Ilość *</th>
                <th className="text-right">Cena brutto (szt.) *</th>
                <th className="text-center">VAT % *</th>
                <th className="text-right">Wartość netto</th>
                <th className="text-right">Wartość VAT</th>
                <th className="text-right">Wartość brutto</th>
                <th className="text-center">—</th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => {
                const q = Number(it.qty || 0);
                const gU = Number(it.price_gross || 0);
                const v = Number(it.vat_rate || 23);
                const nU = gU / (1 + v / 100);
                const g = gU * q;
                const n = nU * q;
                const vv = g - n;
                return (
                  <tr key={idx}>
                    <td className="align-middle">
                      <input
                        className="input w-full"
                        list="services-list"
                        value={it.name}
                        onChange={(e) =>
                          updateItemNameAndAutofill(idx, e.target.value)
                        }
                        placeholder="Zacznij pisać, aby wybrać…"
                        required
                      />
                    </td>
                    <td className="text-center align-middle">
                      <input
                        type="number"
                        min="1"
                        className="input w-full text-right"
                        style={{ minWidth: "10ch" }}
                        value={it.qty}
                        onChange={(e) =>
                          updateItemField(
                            idx,
                            "qty",
                            Number(e.target.value) || 1
                          )
                        }
                        required
                      />
                    </td>
                    <td className="text-right align-middle">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input w-full text-right"
                        value={it.price_gross}
                        onChange={(e) =>
                          updateItemField(
                            idx,
                            "price_gross",
                            Number(e.target.value) || 0
                          )
                        }
                        required
                      />
                    </td>
                    <td className="text-center align-middle">
                      <select
                        className="input w-full text-right"
                        style={{ minWidth: "10ch" }}
                        value={it.vat_rate}
                        onChange={(e) =>
                          updateItemField(
                            idx,
                            "vat_rate",
                            Number(e.target.value) || 23
                          )
                        }
                        required
                      >
                        <option value={23}>23</option>
                        <option value={8}>8</option>
                        <option value={5}>5</option>
                        <option value={0}>0</option>
                      </select>
                    </td>
                    <td className="text-right align-middle">{to2(n)}</td>
                    <td className="text-right align-middle">{to2(vv)}</td>
                    <td className="text-right align-middle">{to2(g)}</td>
                    <td className="text-center align-middle">
                      <button
                        type="button"
                        className="btn-danger px-2 py-1 text-white"
                        onClick={() => removeItemRow(idx)}
                        title="Usuń pozycję"
                        aria-label={`Usuń pozycję ${idx + 1}`}
                      >
                        {/* Іконка кошика підставляється з глобальних стилів/класів; 
                           якщо треба — можна передати як children або замінити текстом */}
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <datalist id="services-list">
            {servicesDict.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div className="mt-2">
          <button type="button" className="btn-secondary" onClick={addItemRow}>
            ➕ Dodaj pozycję
          </button>
        </div>

        <div className="mt-3 text-right text-sm text-gray-700">
          <div className="inline-block">
            <div>
              Razem netto: <b>{to2(totals.net)}</b>
            </div>
            <div>
              Razem VAT: <b>{to2(vat)}</b>
            </div>
            <div>
              Razem brutto: <b>{to2(totals.gross)}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 flex gap-2">
        <button type="button" className="btn-primary" onClick={onSave}>
          Zapisz fakturę
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </div>
  );
}
