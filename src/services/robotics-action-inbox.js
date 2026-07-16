export function enqueueRobotActionEnvelope(current, envelope, limit = 50) {
  const items = Array.isArray(current) ? current : [];
  if (!envelope?.token || items.some((item) => item.token === envelope.token)) return items;
  return [...items, envelope].slice(-limit);
}

export function removeRobotActionEnvelope(current, handled) {
  return (Array.isArray(current) ? current : []).filter(
    (item) => item !== handled && item.token !== handled?.token
  );
}
