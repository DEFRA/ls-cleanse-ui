import nunjucks from 'nunjucks'

/**
 * JSON for a `<script type="application/json">` element. `<`, `>` and `&` are escaped so nothing
 * in the data can close the element or open a comment, and the two line separators JavaScript
 * once refused are escaped too. The result is marked safe, because escaping it as HTML would
 * break the JSON.
 */
export function jsonScript(value) {
  const json = (JSON.stringify(value ?? null) ?? 'null')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

  return new nunjucks.runtime.SafeString(json)
}
