package io.github.mansoor.familyvault.push

import android.content.Context

/**
 * What the push side keeps between launches, in the app's own preferences
 * (never backed up: see with-data-extraction). Written with commit(): the
 * service may be stopped as soon as it returns.
 */
internal class Store(context: Context) {
  private val prefs =
    context.applicationContext.getSharedPreferences("fdv.unifiedpush", Context.MODE_PRIVATE)

  /** The address the distributor gave, and the keys the vault encrypts to. */
  fun saveEndpoint(url: String, p256dh: String, auth: String, temporary: Boolean) {
    prefs
      .edit()
      .putString(ENDPOINT, url)
      .putString(P256DH, p256dh)
      .putString(AUTH, auth)
      .putBoolean(TEMPORARY, temporary)
      .remove(FAILURE)
      .commit()
  }

  fun clearEndpoint() {
    prefs.edit().remove(ENDPOINT).remove(P256DH).remove(AUTH).remove(TEMPORARY).commit()
  }

  var failure: String?
    get() = prefs.getString(FAILURE, null)
    set(value) {
      prefs.edit().putString(FAILURE, value).commit()
    }

  /** Where a tapped notification asked to go, until the app takes it. */
  var pendingOpen: String?
    get() = prefs.getString(OPEN, null)
    set(value) {
      prefs.edit().putString(OPEN, value).commit()
    }

  /** A session_ended arrived: the app finishes the sign-out before its first screen. */
  var sessionEnded: Boolean
    get() = prefs.getBoolean(SESSION_ENDED, false)
    set(value) {
      prefs.edit().putBoolean(SESSION_ENDED, value).commit()
    }

  fun snapshot(): Map<String, Any?> =
    mapOf(
      "endpoint" to prefs.getString(ENDPOINT, null),
      "p256dh" to prefs.getString(P256DH, null),
      "auth" to prefs.getString(AUTH, null),
      "temporary" to prefs.getBoolean(TEMPORARY, false),
      "failure" to prefs.getString(FAILURE, null),
    )

  private companion object {
    const val ENDPOINT = "endpoint"
    const val P256DH = "p256dh"
    const val AUTH = "auth"
    const val TEMPORARY = "temporary"
    const val FAILURE = "failure"
    const val OPEN = "open"
    const val SESSION_ENDED = "session_ended"
  }
}
