import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { LandingPage } from "./pages/LandingPage";
import { PricingPage } from "./pages/PricingPage";

export function App() {
  return (
    <BrowserRouter>
      <div className="page">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/pricing" element={<PricingPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
