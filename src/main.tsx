import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "./router";
import App from "./App";
import AppErrorBoundary from "./Components/AppErrorBoundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RouterProvider>
        <App />
      </RouterProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
