package io.github.mansoor.familyvault.clipboard

import android.content.ClipDescription
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A copied identity number (5.31): marked sensitive, and gone after a minute. */
class ClipRulesTest {
  @Test
  fun itsOwnCopyIsClearedAndSoIsWhatItCannotSee() {
    assertTrue(ClipRules.shouldClear(readable = true, label = ClipRules.LABEL))
    // At the back, Android shows the app nothing: the number may still be there.
    assertTrue(ClipRules.shouldClear(readable = false, label = null))
  }

  @Test
  fun somethingElseCopiedSinceIsLeft() {
    assertFalse(ClipRules.shouldClear(readable = true, label = "Notes"))
    assertFalse(ClipRules.shouldClear(readable = true, label = null))
    assertFalse(ClipRules.shouldClear(readable = true, label = ""))
  }

  @Test
  fun aMinuteIsAMinuteAndNothingOddIsTaken() {
    assertEquals(60_000L, ClipRules.delay(60_000))
    assertEquals(ClipRules.MIN_MS, ClipRules.delay(0))
    assertEquals(ClipRules.MIN_MS, ClipRules.delay(-5))
    assertEquals(ClipRules.MAX_MS, ClipRules.delay(Int.MAX_VALUE))
  }

  @Test
  fun theCopyIsMarkedSensitiveByAndroidsOwnName() {
    assertEquals(ClipDescription.EXTRA_IS_SENSITIVE, ClipRules.EXTRA_IS_SENSITIVE)
  }

  /** The alarm (outside the app's process) goes off a minute on, on the clock that counts while asleep. */
  @Test
  fun theAlarmIsSetAMinuteOnWhateverBecomesOfTheApp() {
    assertEquals(1_060_000L, ClipRules.clearAt(1_000_000L, 60_000))
    assertEquals(1_000_000L + ClipRules.MAX_MS, ClipRules.clearAt(1_000_000L, Int.MAX_VALUE))
    assertEquals(1_000_000L + ClipRules.MIN_MS, ClipRules.clearAt(1_000_000L, 0))
  }

  /** Back in front, or started again after a kill: a copy of the app's left behind goes. */
  @Test
  fun aCopyLeftBehindGoesOnceItsMinuteIsOver() {
    val due = 2_000_000L
    // Its minute not yet over: the alarm will do it.
    assertFalse(ClipRules.sweepClears(true, ClipRules.LABEL, due, due - 1))
    // Over: now.
    assertTrue(ClipRules.sweepClears(true, ClipRules.LABEL, due, due))
    assertTrue(ClipRules.sweepClears(true, ClipRules.LABEL, due, due + 3_600_000L))
    // No clear waits for it any more (a restart, a force stop): now.
    assertTrue(ClipRules.sweepClears(true, ClipRules.LABEL, null, due))
    // The clock turned back past the copy: now, not in a year.
    assertTrue(ClipRules.sweepClears(true, ClipRules.LABEL, due, due - ClipRules.MAX_MS - 1))
  }

  @Test
  fun somebodyElsesCopyOrOneItCannotSeeIsNotSweptAway() {
    assertFalse(ClipRules.sweepClears(true, "Notes", null, 0L))
    assertFalse(ClipRules.sweepClears(true, null, null, 0L))
    // Not in focus yet: nothing can be read, so nothing is swept (the alarm still clears it).
    assertFalse(ClipRules.sweepClears(false, null, null, 0L))
  }
}
