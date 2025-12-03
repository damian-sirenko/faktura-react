import React from "react";
import ClientsPage from "./ClientsPage";

export default function ClientsPrivatePage() {
  return (
    <ClientsPage
      forcedMode="perpiece"
      hideModeSwitcher
      pageTitle="📒 Klienci — prywatni"
    />
  );
}
