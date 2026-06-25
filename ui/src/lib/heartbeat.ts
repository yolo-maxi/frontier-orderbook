const HEARTBEAT_URL = "https://frontier-bots.repo.box/heartbeat";
const HEARTBEAT_MS = 20_000;

function postHeartbeat() {
  if (document.visibilityState !== "visible") return;
  fetch(HEARTBEAT_URL, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}

export function startPresenceHeartbeat(): () => void {
  postHeartbeat();
  const interval = window.setInterval(postHeartbeat, HEARTBEAT_MS);
  const onVisibility = () => postHeartbeat();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
