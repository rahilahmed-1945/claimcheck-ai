import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
