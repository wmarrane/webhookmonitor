import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Requests } from "./pages/Requests.js";
import { Transaction } from "./pages/Transaction.js";
import { Import } from "./pages/Import.js";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="requests" element={<Requests />} />
        <Route path="transactions/:txn" element={<Transaction />} />
        <Route path="import" element={<Import />} />
      </Route>
    </Routes>
  );
}
