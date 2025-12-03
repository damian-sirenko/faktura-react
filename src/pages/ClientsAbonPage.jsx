import React from "react";
import ClientsPage from "./ClientsPage";

export default function ClientsAbonPage() {
  return (
    <ClientsPage
      forcedMode="abonament"
      hideModeSwitcher
      pageTitle="📒 Klienci — abonamentowi"
    />
  );
}
