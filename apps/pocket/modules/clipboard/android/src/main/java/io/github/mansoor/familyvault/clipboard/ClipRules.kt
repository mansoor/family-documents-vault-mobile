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
   * When the alarm that clears a copy goes off, on the clock that counts
   * while the phone sleeps (SystemClock.elapsedRealtime): the alarm lives
   * outside the app's process, so a copy is cleared even if the app is
   * swiped away, killed or frozen within its minute.
   */
  fun clearAt(nowElapsedMs: Long, askedMs: Int): Long = nowElapsedMs + delay(askedMs)

  /**
   * Whether to clear the clipboard when the time is up. The app's own copy
   * goes; so does whatever it cannot see — Android shows an app at the back
   * nothing of the clipboard (`readable` false), and the number may still be
   * there. Only something the app can see is somebody else's copy is left.
   */
  fun shouldClear(readable: Boolean, label: CharSequence?): Boolean =
    !readable || label?.toString() == LABEL

  /** What a sweep does with what is on the clipboard. */
  sealed class Sweep {
    /** Not the app's to touch: somebody else's copy, or nothing it can see. */
    object Leave : Sweep()

    /** The app's own copy, past its minute (or with no time kept): cleared now. */
    object Clear : Sweep()

    /**
     * The app's own copy, not yet due: its clear is set again for what is
     * left of the minute — an alarm a force stop took away comes back, and
     * one still set is only replaced.
     */
    data class Rearm(val inMs: Long) : Sweep()
  }

  /**
   * At a start, or back in front: what becomes of a copy of the app's own
   * still on the clipboard. It goes once its minute is over by the wall
   * clock (`dueAtMs`), when no time is kept for it, or when the clock was
   * turned back past the copy; before then its clear is set again, since a
   * force stop drops the app's alarms but not the time. What the app cannot
   * see, or somebody else's copy, is left.
   */
  fun sweep(readable: Boolean, label: CharSequence?, dueAtMs: Long?, nowMs: Long): Sweep {
    if (!readable || label?.toString() != LABEL) return Sweep.Leave
    if (dueAtMs == null || nowMs >= dueAtMs || dueAtMs - nowMs > MAX_MS) return Sweep.Clear
    return Sweep.Rearm(dueAtMs - nowMs)
  }
}
