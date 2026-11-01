import { NavLink } from "react-router";
import { HealthBadge } from "./HealthBadge";

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <nav className="flex items-center gap-6 text-sm font-medium">
          <NavLink to="/" end className={linkClass}>
            Invoices
          </NavLink>
          <NavLink to="/chat" className={linkClass}>
            AI Assistant
          </NavLink>
        </nav>
        <HealthBadge />
      </div>
    </header>
  );
}

function linkClass({ isActive }: { readonly isActive: boolean }): string {
  if (isActive) {
    return "text-slate-950 underline decoration-2 underline-offset-4";
  }
  return "text-slate-600 hover:text-slate-950";
}
