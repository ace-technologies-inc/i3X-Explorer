// Hands the redirect back to the explorer tab on this origin; a channel works even if the sign-in pages dropped window.opener.
const channel = new BroadcastChannel('i3x-oauth-callback')
channel.postMessage({ search: window.location.search })
channel.close()
if (window.opener) {
  window.close()
} else {
  document.getElementById('message').textContent = 'Sign-in finished. You can close this tab and return to i3X Explorer.'
}
