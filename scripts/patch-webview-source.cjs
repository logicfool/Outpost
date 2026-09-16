const before = `    if (request.URL.host) {
      [webView loadRequest:request];
    }
    else {
      NSURL* readAccessUrl = allowingReadAccessToURL ? [RCTConvert NSURL:allowingReadAccessToURL] : request.URL;
      [webView loadFileURL:request.URL allowingReadAccessToURL:readAccessUrl];
    }`;
const after = `    // OUTPOST_WEBVIEW_FILE_SCHEME: only actual file URLs may use loadFileURL.
    if (request.URL.isFileURL) {
      NSURL* readAccessUrl = allowingReadAccessToURL ? [RCTConvert NSURL:allowingReadAccessToURL] : request.URL;
      [webView loadFileURL:request.URL allowingReadAccessToURL:readAccessUrl];
    }
    else {
      [webView loadRequest:request];
    }`;
function patchWebViewSource(source) {
  if (source.includes('OUTPOST_WEBVIEW_FILE_SCHEME')) {
    if (!source.includes(after) || source.includes(before))
      throw new Error('The iOS WebView file-scheme guard changed; review before building.');
    return source;
  }
  if (source.split(before).length !== 2)
    throw new Error('Review the pinned iOS WebView source before applying its file-scheme guard.');
  return source.replace(before, after);
}
module.exports = { patchWebViewSource, before, after };
