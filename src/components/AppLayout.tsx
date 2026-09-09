import { NavLink, Outlet } from "react-router-dom";
import { CedraLogo } from "./Logo";

const NAV_ITEMS = [
  { to: "/", label: "Overblik", end: true },
  { to: "/kunder", label: "Kunder" },
];

function todayFormatted() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-cedra-50">
      <header className="bg-white border-b border-cedra-100 sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-6">
          <CedraLogo tagline="Kundestyringsværktøj" />
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-cedra-700 text-white"
                      : "text-cedra-800 hover:bg-cedra-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="text-xs text-cedra-700/60 whitespace-nowrap">
            Data fra: {todayFormatted()}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-cedra-700/50 py-4">
        Cedra Kundestyringsværktøj — internt revisionsværktøj, demo-data
      </footer>
    </div>
  );
}
