import { Routes, Route } from 'react-router-dom';
import Navigation from './components/Navigation';
import DepthCalculator from './components/DepthCalculator';
import LiquidityMonitor from './components/LiquidityMonitor';
import './App.css';

function App() {
  return (
    <div className="app-wrapper">
      <Navigation />
      <Routes>
        <Route path="/" element={<DepthCalculator />} />
        <Route path="/monitor" element={<LiquidityMonitor />} />
      </Routes>
    </div>
  );
}

export default App;
