import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DataProvider } from "./data/store";
import { AppLayout } from "./components/AppLayout";
import { Dashboard } from "./pages/Dashboard";
import { Clients } from "./pages/Clients";
import { ClientDetail } from "./pages/ClientDetail";

export default function App() {
  return (
    <DataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="kunder" element={<Clients />} />
            <Route path="kunder/:id" element={<ClientDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DataProvider>
  );
}
