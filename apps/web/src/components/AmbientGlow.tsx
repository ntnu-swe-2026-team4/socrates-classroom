export function AmbientGlow() {
  return (
    <div aria-hidden className="glow-stage pointer-events-none absolute inset-0 overflow-hidden">
      <div className="glow-blob glow-a" />
      <div className="glow-blob glow-b" />
      <div className="glow-blob glow-c" />
    </div>
  );
}
