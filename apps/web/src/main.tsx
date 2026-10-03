import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./design/global.css";
import { CreatePage } from "./features/create/CreatePage";
import { EditorPage } from "./features/editor/EditorPage";
import { BlueprintPage } from "./features/report/BlueprintPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreatePage />} />
        <Route path="/e/:envId" element={<EditorPage />} />
        <Route path="/e/:envId/blueprint" element={<BlueprintPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
