package io.github.mansoor.familyvault.push

import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * What the distributor sends this app, through the connector (4.14). It
 * runs with the app closed: a message is shown in the app's own words or
 * not at all, and a session_ended removes the offline copies at once.
 */
class VaultPushService : PushService() {
  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    if (instance != INSTANCE) return
    val store = Store(this)
    val keys = endpoint.pubKeySet
    if (keys == null) {
      // The vault encrypts every message (RFC 8291): an address without keys is no use.
      store.failure = "NO_KEYS"
      PushEvents.emit(mapOf("kind" to "failed", "reason" to "NO_KEYS"))
      return
    }
    store.saveEndpoint(endpoint.url, keys.pubKey, keys.auth, endpoint.temporary)
    PushEvents.emit(mapOf("kind" to "endpoint"))
  }

  override fun onMessage(message: PushMessage, instance: String) {
    // Only what the connector opened with this phone's own keys is read.
    if (instance != INSTANCE || !message.decrypted) return
    val rendered = Payloads.render(String(message.content, Charsets.UTF_8)) ?: return
    if (rendered.type == Rendered.Type.SESSION_ENDED) {
      // The flag first: whatever happens next, the app finishes it before its first screen.
      Store(this).sessionEnded = true
      Wipe.offlineCopies(this)
    }
    Notifier.show(this, rendered)
    PushEvents.emit(mapOf("kind" to "message", "type" to rendered.type.wire))
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    if (instance != INSTANCE) return
    Store(this).failure = reason.name
    PushEvents.emit(mapOf("kind" to "failed", "reason" to reason.name))
  }

  override fun onUnregistered(instance: String) {
    if (instance != INSTANCE) return
    Store(this).clearEndpoint()
    PushEvents.emit(mapOf("kind" to "unregistered"))
  }
}
