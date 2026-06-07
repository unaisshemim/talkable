import { Link } from "react-router-dom";
import { FeatureCarousel } from "../components/FeatureCarousel";

export function LandingPage() {
  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Realtime voice control for your website builder</p>
        <h1 className="hero-title">Talkable</h1>
        <p className="hero-subtitle">
          Don't type prompts. Just talk. See Magic.
        </p>
        <p className="hero-description">
          Talkable turns your browser extension into a live voice interface for building websites. Say what you want,
          watch the extension stream your request, and let the local coding agent update your project while progress
          appears in realtime.
        </p>
        <div className="hero-actions">
          <Link to="/pricing" className="btn btn-dark">
            Start building
            <span className="arrow" aria-hidden="true">→</span>
          </Link>
          <button type="button" className="btn btn-dark">
            Install extension
          </button>
          <button type="button" className="btn btn-outline">
            See workflow
          </button>
        </div>
      </section>

      <section className="voice-demo" aria-label="Talkable voice workflow preview">
        <div className="voice-card voice-card-speaker">
          <span className="voice-label">You say</span>
          <p>"Make the hero section warmer, add a pricing CTA, and run the build."</p>
        </div>
        <div className="voice-bridge" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="voice-card voice-card-agent">
          <span className="voice-label">Talkable does</span>
          <p>Streams audio, creates a validated task, runs Codex locally, and reports every step back to Chrome.</p>
        </div>
      </section>

      <FeatureCarousel />
    </>
  );
}
