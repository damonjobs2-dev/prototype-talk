export function expectedMismatch(card, trace) {
  const expected = card?.expected_after;
  if (!expected) return false;
  const route = String(trace.after?.route || '');
  const visibleSample = String(trace.after?.visible_text || '');
  const visible = [visibleSample, ...(trace.after?.dialogs || [])].join(' ');
  if (expected.route_contains && route && !route.includes(expected.route_contains)) return true;
  // A list in the card can be rendered as separate lines in the page.
  // Absence from a truncated recorder sample is not a contradiction.
  if (expected.visible_text && visible && visibleSample.length < 2400) {
    const parts = String(expected.visible_text).split(/[、，,；;\n]+/).map((item) => item.trim()).filter(Boolean);
    return (parts.length > 1 ? parts : [String(expected.visible_text)]).some((part) => !visible.includes(part));
  }
  return false;
}
