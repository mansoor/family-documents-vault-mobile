package io.github.mansoor.familyvault.push

/**
 * From the service to the app, when the app is running: an endpoint, a
 * registration that failed or ended, a message's type, a tap. When it is
 * not, the Store holds what the app needs at its next start.
 */
internal object PushEvents {
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null

  fun emit(body: Map<String, Any?>) {
    try {
      listener?.invoke(body)
    } catch (e: Throwable) {
      // The app's side going away mid-call changes nothing here.
    }
  }
}
