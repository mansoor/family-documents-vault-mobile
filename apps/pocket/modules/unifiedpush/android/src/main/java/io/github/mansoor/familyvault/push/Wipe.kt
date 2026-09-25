package io.github.mansoor.familyvault.push

import android.content.Context
import java.io.File

/**
 * The offline copies go the moment the vault says this phone was signed
 * out (4.14), with the app not running: the Essentials' two databases,
 * where expo-sqlite keeps them (files/SQLite), journals included. The app
 * finishes the rest — its session, its settings for them — at its next
 * start, before any screen (the session_ended flag).
 */
internal object Wipe {
  private val DATABASES = listOf("essentials.db", "essentials-private.db")
  private val SUFFIXES = listOf("", "-wal", "-shm", "-journal")

  /** True when nothing of them is left. */
  fun offlineCopies(context: Context): Boolean {
    val dir = File(context.filesDir, "SQLite")
    var gone = true
    for (name in DATABASES) {
      for (suffix in SUFFIXES) {
        val f = File(dir, name + suffix)
        if (f.exists() && !f.delete()) gone = false
      }
    }
    return gone
  }
}
