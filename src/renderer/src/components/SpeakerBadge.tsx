/**
 * Fixed-size speaker badge shared by LiveSession and History.
 * "我" -> brand green; TA/TA2/TA3... -> per-speaker color with a tiny
 * corner index; any other (custom) name -> first character.
 */
const TA_COLORS = ['#0e9f8a', '#e0854a', '#c858a8', '#3a8fd6', '#8a6ad6'];

export function SpeakerBadge({ speaker }: { speaker: string }) {
  if (speaker === '我') {
    return (
      <span className="seg-badge me" title="我">
        我
      </span>
    );
  }
  const m = speaker.match(/^TA(\d*)$/);
  if (m) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    const color = TA_COLORS[(n - 1) % TA_COLORS.length];
    return (
      <span className="seg-badge ta" title={speaker} style={{ background: color }}>
        TA
        {n > 1 && <i className="badge-sub">{n}</i>}
      </span>
    );
  }
  return (
    <span className="seg-badge a" title={speaker}>
      {speaker.slice(0, 1)}
    </span>
  );
}
