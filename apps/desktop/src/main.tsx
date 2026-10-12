import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./lib/app-confirm";
import "./styles/app.css";
import { installRendererFailureHandlers } from "./lib/renderer-failures";

installRendererFailureHandlers(window, (failure) => window.xAgent.appReport.reportRendererFailure(failure));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
