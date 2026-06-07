import { Link } from "react-router-dom";

const steps = [
  {
    number: "01",
    title: "Open the extension",
    description:
      "Choose the page or element you want to change. Talkable captures the browser context and selected project path before you speak.",
  },
  {
    number: "02",
    title: "Say the change",
    description:
      "Describe the update naturally, from copy edits and layout polish to new pages. Your voice becomes a clear engineering task.",
  },
  {
    number: "03",
    title: "Watch Codex work",
    description:
      "Talkable streams progress while Codex edits the local repo, runs practical checks, and reports the result back to the extension.",
  },
];

const signals = [
  "Selected element context",
  "Current viewport details",
  "Local project path",
  "Transcript and task summary",
];

export function HowItWorksPage() {
  return (
    <div className="how-page">
      <section className="how-hero">
        <div className="how-hero-copy">
          <p className="pricing-eyebrow">how it works</p>
          <h1>Voice in the browser. Code in your repo.</h1>
          <p>
            Talkable connects a Chrome extension, realtime speech capture, and a local coding agent so website changes
            can start from the page you are already looking at.
          </p>
          <div className="hero-actions">
            <Link to="/pricing" className="btn btn-dark">
              Start building
            </Link>
            <Link to="/" className="btn btn-outline">
              View product
            </Link>
          </div>
        </div>

        <div className="how-command-panel" aria-label="Voice command example">
          <span className="voice-label">Voice task</span>
          <p>"Create a how-it-works page and match the existing design."</p>
          <div className="how-status-list">
            <span>Listening</span>
            <span>Task created</span>
            <span>Editing files</span>
          </div>
        </div>
      </section>

      <section className="how-steps" aria-label="Talkable workflow">
        {steps.map((step) => (
          <article key={step.number} className="how-step">
            <span>{step.number}</span>
            <h2>{step.title}</h2>
            <p>{step.description}</p>
          </article>
        ))}
      </section>

      <section className="how-context">
        <div>
          <p className="pricing-eyebrow">context handoff</p>
          <h2>Every request includes the details Codex needs.</h2>
          <p>
            The extension does more than send a transcript. It passes the current page, selected UI target, viewport,
            and local project location so the agent can make a precise change.
          </p>
        </div>

        <ul className="how-signal-list">
          {signals.map((signal) => (
            <li key={signal}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M4 9L7.5 12.5L14 6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {signal}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
