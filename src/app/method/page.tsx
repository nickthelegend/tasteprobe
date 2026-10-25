import type { Metadata } from "next";
import { MethodSections } from "@/components/Landing";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "Method · TasteProbe" };

// The full method, moved off the landing: the wine list of seven steps, how to read a glass, the
// three-way re-pour and the back-label FAQ. Every glass here is stamped as an example.
export default function Method() {
  return <main>
    <div className="sheet" id="top">
      <header className="sheet-head">
        <Logo href="/" ring="#2a0f2e" dot="#ff6ec7" className="sheet-logo" />
        <a className="tp-btn tp-btn-line method-back" href="/">Overview</a>
        <a className="tp-btn tp-btn-berry" href="/#room">Tasting room</a>
      </header>
      <section className="method-hero" aria-labelledby="method-title">
        <p className="kicker">Method</p>
        <h1 id="method-title">How a flight is poured</h1>
      </section>
      <MethodSections />
    </div>
    <footer className="colophon">
      <Logo href="#top" ring="#fbf3f6" dot="#ff6ec7" />
      <span><a href="https://github.com/nickthelegend/tasteprobe">github.com/nickthelegend/tasteprobe</a> · MIT · Copyright (c) 2026 Nivesh Gajengi</span>
    </footer>
  </main>;
}
