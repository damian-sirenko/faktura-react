import React from "react";
import ClientsPage from "./ClientsPage";

export default function ClientsArchivePage() {
  return (
    <ClientsPage
      forcedMode="all"
      hideModeSwitcher
      forceArchivedView
      pageTitle="📒 Klienci — archiwum"
    />
  );
}
