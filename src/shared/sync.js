/**
 * Clock-based sync — every TV independently computes the correct slide
 * using a deterministic formula. No coordinator required.
 */

/**
 * Compute which slide index should be showing right now.
 */
export function getCurrentSlide(playlist, intervalSeconds, clockOffset) {
  if (!playlist || playlist.length === 0) return 0
  const nowSeconds = Math.floor((Date.now() + clockOffset) / 1000)
  return Math.floor(nowSeconds / intervalSeconds) % playlist.length
}

/**
 * Compute ms remaining until the next slide transition.
 * Used to align the first timeout precisely to the clock boundary.
 */
export function getMsUntilNextSlide(intervalSeconds, clockOffset) {
  const nowMs = Date.now() + clockOffset
  const intervalMs = intervalSeconds * 1000
  return intervalMs - (nowMs % intervalMs)
}

/**
 * Start the slide cycle. Uses recursive setTimeout aligned to the clock
 * so transitions always happen at the exact same wall-clock moment on
 * every device, regardless of when each TV booted.
 *
 * @param {object} state - { playlist, interval_seconds }
 * @param {number} clockOffset - ms offset between local clock and Firebase server
 * @param {function} onSlide - called with (slideIndex) on each transition
 * @returns {function} cancel - call to stop the cycle
 */
export function scheduleNext(state, clockOffset, onSlide) {
  let cancelled = false
  let timeoutId = null

  function tick() {
    if (cancelled) return
    const idx = getCurrentSlide(state.playlist, state.interval_seconds, clockOffset)
    onSlide(idx)
    const msUntilNext = getMsUntilNextSlide(state.interval_seconds, clockOffset)
    timeoutId = setTimeout(tick, msUntilNext)
  }

  // Fire immediately so the TV shows the right slide on boot,
  // then wait for the clock boundary before the first transition.
  const idx = getCurrentSlide(state.playlist, state.interval_seconds, clockOffset)
  onSlide(idx)
  const msUntilNext = getMsUntilNextSlide(state.interval_seconds, clockOffset)
  timeoutId = setTimeout(tick, msUntilNext)

  return function cancel() {
    cancelled = true
    if (timeoutId !== null) clearTimeout(timeoutId)
  }
}
