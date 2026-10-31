// @local/dsh-quote-reply - host half.
//
// The feature is browser-only: the selection pill reads the selected text from
// the DOM and quotes it through the official InputActions. No host service, no
// route, no session-log access. The file exists because a bundle row needs a
// loadable node module with an `apply()` entry.
export const name = '@local/dsh-quote-reply'

export function apply() {}
