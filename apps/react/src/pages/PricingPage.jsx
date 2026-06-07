import { Link } from "react-router-dom";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "month",
    description: "For experiments, weekend ideas, and that one side project that keeps winking at you.",
    features: [
      "100K tokens / month, snack-sized but useful",
      "128K context window for tidy brain dumps",
      "Community support from fellow keyboard pilots",
      "Standard API rate limits, no cape included",
      "MiniMax Code access for poking around",
    ],
    cta: "Start for Free",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$50",
    period: "/ month",
    description: "For developers and small teams who have graduated from 'just one quick test.'",
    features: [
      "10M tokens / month for serious button pressing",
      "1M context window, because tabs multiply",
      "Priority API access when patience clocks out",
      "MSA sparse attention doing the heavy lifting",
      "Multimodal inputs for show-and-tell",
      "Email support from actual humans",
    ],
    cta: "Start Pro Trial",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large-scale deployments, big ambitions, and calendar invites with many initials.",
    features: [
      "Unlimited tokens, because counting gets old",
      "1M context window for the whole saga",
      "Dedicated GPU clusters with room to sprint",
      "Custom fine-tuning for your secret sauce",
      "SOC 2 compliance without the drama",
      "24/7 dedicated support, coffee not required",
      "SLA guarantees with fewer crossed fingers",
    ],
    cta: "Talk to Sales",
    highlighted: false,
  },
];

export function PricingPage() {
  return (
    <div className="pricing-page">
      <section className="pricing-hero">
        <p className="pricing-eyebrow">pricing page</p>
        <h1>Pricing without the mysterious fog machine</h1>
        <p className="pricing-subtitle">
          Pay for what you use. Start tiny, grow boldly, and let MiniMax M3 handle the token gymnastics.
        </p>
      </section>

      <section className="pricing-grid" aria-label="Pricing plans">
        {plans.map((plan) => (
          <article
            key={plan.name}
            className={plan.highlighted ? "pricing-card highlighted" : "pricing-card"}
          >
            {plan.highlighted && <span className="pricing-badge">Crowd Favorite</span>}
            <h2>{plan.name}</h2>
            <div className="pricing-amount">
              <span className="price">{plan.price}</span>
              {plan.period && <span className="period">{plan.period}</span>}
            </div>
            <p className="pricing-description">{plan.description}</p>
            <ul className="pricing-features">
              {plan.features.map((feature) => (
                <li key={feature}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3 8L6.5 11.5L13 5"
                      stroke="#FF4D4D"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={plan.highlighted ? "btn btn-dark btn-full" : "btn btn-outline btn-full"}
            >
              {plan.cta}
            </button>
          </article>
        ))}
      </section>

      <section className="pricing-usage">
        <h2>Token refill station</h2>
        <p>Need more tokens? Keep building, and we will bill the extra usage without making it weird.</p>
        <div className="usage-table">
          <div className="usage-row usage-header">
            <span>Model</span>
            <span>Input</span>
            <span>Output</span>
          </div>
          <div className="usage-row">
            <span>MiniMax M3</span>
            <span>$0.50 / 1M tokens</span>
            <span>$2.00 / 1M tokens</span>
          </div>
          <div className="usage-row">
            <span>MiniMax M3 · 1M Context</span>
            <span>$1.20 / 1M tokens</span>
            <span>$4.80 / 1M tokens</span>
          </div>
        </div>
      </section>

      <section className="pricing-cta">
        <h2>Ready to make M3 do useful things?</h2>
        <p>Start with the free tier or talk to our team when your deployment starts wearing a blazer.</p>
        <div className="hero-actions">
          <button type="button" className="btn btn-dark">
            Get API Key
          </button>
          <Link to="/" className="btn btn-outline">
            Back to Home
          </Link>
        </div>
      </section>
    </div>
  );
}
