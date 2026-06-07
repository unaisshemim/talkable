import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Logo";

const navLinks = [
  { label: "Product", href: "/" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
];

export function Navbar() {
  const { pathname } = useLocation();

  return (
    <header className="navbar">
      <Link className="navbar-brand" to="/" aria-label="Talkable home">
        <Logo />
        <span>Talkable</span>
      </Link>

      <nav className="navbar-links" aria-label="Primary navigation">
        {navLinks.map((link) => (
          <Link
            key={link.label}
            to={link.href}
            className={pathname === link.href ? "active" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="navbar-actions">
        <button type="button" className="btn btn-dark">
          Get extension
        </button>
        <button type="button" className="btn btn-light">
          Watch demo
        </button>
      </div>
    </header>
  );
}
