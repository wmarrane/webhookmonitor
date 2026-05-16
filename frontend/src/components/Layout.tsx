import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/requests", label: "Requests" },
  { to: "/import", label: "Importação" },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6">
        <h1 className="font-semibold">Monitor de Integração</h1>
        <nav className="flex gap-4 text-sm">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                isActive ? "text-white" : "text-slate-400 hover:text-white"
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
