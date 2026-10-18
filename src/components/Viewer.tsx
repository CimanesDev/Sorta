"use client";
import { useEffect, useState } from "react";

export function Viewer({ images, title }: { images: string[]; title: string }) {
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(false);
  const n = images.length;
  const go = (i: number) => n && setIdx(((i % n) + n) % n);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input[type=text], textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft") setIdx((i) => (n ? (i - 1 + n) % n : 0));
      else if (e.key === "ArrowRight") setIdx((i) => (n ? (i + 1) % n : 0));
      else if (e.key === "z") setZoom((z) => !z);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  return (
    <section className="viewer" aria-label="Screenshots">
      <div className="viewer-bar">
        <span className="title">{title}</span>
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(idx - 1)} aria-label="Previous screenshot">
              ◀
            </button>
            <span className="pos">
              {idx + 1} / {n}
            </span>
            <button type="button" onClick={() => go(idx + 1)} aria-label="Next screenshot">
              ▶
            </button>
          </>
        )}
        <button type="button" onClick={() => setZoom((z) => !z)} title="Zoom (Z)">
          {zoom ? "Fit" : "Zoom"} <kbd>Z</kbd>
        </button>
      </div>
      <div className={`stage${zoom ? " zoomed" : ""}`}>
        {n ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={images[idx]} src={`/api/images/${images[idx]}`} alt={`Screenshot ${idx + 1} of ${n}`} onClick={() => setZoom((z) => !z)} />
        ) : (
          <p className="muted">No screenshots.</p>
        )}
      </div>
      {n > 1 && (
        <div className="thumbs">
          {images.map((src, i) => (
            <button key={src} type="button" className={i === idx ? "active" : undefined} onClick={() => go(i)} aria-label={`Screenshot ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/images/${src}`} alt="" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
