import { useState } from "react";

const slides = [
  [
    {
      icon: "code",
      title: "Talk to your project",
      description: "Describe website changes out loud from the browser extension.",
    },
    {
      icon: "search",
      title: "Realtime task capture",
      description: "Audio becomes transcript, intent, and a structured Codex task.",
    },
    {
      icon: "briefcase",
      title: "Local project control",
      description: "Your backend keeps secrets local and works only in the selected folder.",
    },
  ],
  [
    {
      icon: "code",
      title: "Build by conversation",
      description: "Ask for layout, styling, copy, and code updates without leaving the page.",
    },
    {
      icon: "search",
      title: "Progress in the toolbar",
      description: "See listening state, task status, changed files, and completion events.",
    },
    {
      icon: "briefcase",
      title: "Stop anytime",
      description: "Cancel audio streaming and keep control over the local coding session.",
    },
  ],
  [
    {
      icon: "code",
      title: "Extension-first workflow",
      description: "Use Chrome as the command surface while your code stays on your machine.",
    },
    {
      icon: "search",
      title: "Made for websites",
      description: "Tune copy, sections, responsive layout, and visual polish by voice.",
    },
    {
      icon: "briefcase",
      title: "Built for Codex",
      description: "Voice requests are translated into engineering tasks, not chat replies.",
    },
  ],
];

function FeatureIcon({ type }) {
  if (type === "code") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M5 6L2 9L5 12" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 6L16 9L13 12" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 4L8 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "search") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="4.5" stroke="white" strokeWidth="1.5" />
        <path d="M11.5 11.5L15 15" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="6.5" y="6.5" width="3" height="3" rx="0.5" stroke="white" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="12" height="9" rx="1.5" stroke="white" strokeWidth="1.5" />
      <path d="M6 6V5C6 3.895 6.895 3 8 3H10C11.105 3 12 3.895 12 5V6" stroke="white" strokeWidth="1.5" />
      <path d="M3 10H15" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

export function FeatureCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const total = slides.length;

  function goTo(index) {
    setActiveSlide((index + total) % total);
  }

  return (
    <section className="feature-carousel" aria-label="Product features">
      <div className="feature-carousel-bg" aria-hidden="true">
        <div className="feature-carousel-pattern" />
        <div className="decor decor-bubble decor-bubble-1" />
        <div className="decor decor-bubble decor-bubble-2" />
        <div className="decor decor-globe" />
      </div>

      <button
        type="button"
        className="carousel-arrow carousel-arrow-left"
        aria-label="Previous slide"
        onClick={() => goTo(activeSlide - 1)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="feature-cards">
        {slides[activeSlide].map((card) => (
          <article key={card.title} className="feature-card">
            <div className="feature-card-icon">
              <FeatureIcon type={card.icon} />
            </div>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </article>
        ))}
      </div>

      <button
        type="button"
        className="carousel-arrow carousel-arrow-right"
        aria-label="Next slide"
        onClick={() => goTo(activeSlide + 1)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="carousel-dots" role="tablist" aria-label="Feature slides">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === activeSlide}
            aria-label={`Slide ${i + 1}`}
            className={i === activeSlide ? "dot active" : "dot"}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </section>
  );
}
