import { NavLink } from "react-router-dom";

export function BottomNav() {
  return (
    <nav className="nav">
      <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
        <span className="ic">▦</span>
        Products
      </NavLink>
      <NavLink to="/customers" className={({ isActive }) => (isActive ? "active" : "")}>
        <span className="ic">☏</span>
        Customers
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
        <span className="ic">⚙</span>
        Settings
      </NavLink>
    </nav>
  );
}
