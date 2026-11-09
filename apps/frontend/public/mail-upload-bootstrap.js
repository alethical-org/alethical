/* Runs before app code or outside resources on the private mail demo. */
(function () {
  if (window.location.pathname.replace(/\/$/, '') !== '/mail-upload') return;
  var invitation = new URLSearchParams(window.location.hash.slice(1)).get('invite');
  if (invitation !== null) window.__alethicalMailInvitation = invitation;
  // No query or fragment is needed by this route. Never preserve an accidental
  // query-string credential in history or a later same-origin referrer.
  window.history.replaceState(window.history.state, '', window.location.pathname);
})();
