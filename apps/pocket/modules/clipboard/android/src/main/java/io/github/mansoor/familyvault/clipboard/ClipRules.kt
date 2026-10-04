package io.github.mansoor.familyvault.clipboard

/**
 * When a copied identity number leaves the clipboard (5.31), kept apart
 * from Android's classes so the JVM tests can say it.
 */
object ClipRules {
  /** What the app's copies are called on the clipboard: how it knows its own. */
  const val LABEL = "Family Vault"

  /**
   * ClipDescription.EXTRA_IS_SENSITIVE (Android 13): the system's preview,
   * and a keyboard's clipboard suggestions, show dots instead of the number.
   * Written out, so it compiles for any Android; older ones ignore it.
   */
  const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"

  /** Never sooner than a second, never later than five minutes, whatever is asked. */
  const val MIN_MS = 1_000L
  const val MAX_MS = 300_000L

  fun delay(askedMs: Int): Long = askedMs.toLong().coerceIn(MIN_MS, MAX_MS)

  /**
   * Whether to clear the clipboard when the time is up. The app's own copy
   * goes; so does whatever it cannot see — Android shows an app at the back
   * nothing of the clipboard (`readable` false), and the number may still be
   * there. Only something the app can see is somebody else's copy is left.
   */
  fun shouldClear(readable: Boolean, label: CharSequence?): Boolean =
    !readable || label?.toString() == LABEL
}
