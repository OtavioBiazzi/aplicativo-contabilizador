import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";
import "./styles/pdv-final-fixes.css";
import "./styles/financial-workspace.css";
import "./styles/help-and-summary.css";
import "./styles/simple-finance.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
