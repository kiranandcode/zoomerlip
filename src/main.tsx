import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./fonts.css";
import "./style.css";
import "./theme.css";
import "./mobile.css";
import { applyPreferences, readPreferences } from "./appearance";
applyPreferences(readPreferences());
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
