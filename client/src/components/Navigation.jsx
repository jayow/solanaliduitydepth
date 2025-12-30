import { NavLink } from 'react-router-dom';
import './Navigation.css';

function Navigation() {
  return (
    <nav className="main-nav">
      <div className="nav-container">
        <div className="nav-brand">
          <h2>Solana Liquidity</h2>
        </div>
        <div className="nav-links">
          <NavLink 
            to="/" 
            className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
          >
            📊 Depth Calculator
          </NavLink>
          <NavLink 
            to="/monitor" 
            className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
          >
            💧 Liquidity Monitor
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;

