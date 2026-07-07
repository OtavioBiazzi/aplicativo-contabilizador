import React from "react";
import ReactDOM from "react-dom/client";
import { PdvApp } from "./PdvApp";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PdvApp />
  </React.StrictMode>
);
