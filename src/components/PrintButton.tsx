"use client";

export function PrintButton() {
  return <button type="button" className="tp-btn tp-btn-berry" onClick={() => window.print()}>Print or save as PDF</button>;
}
