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
}
