//! Identify the macOS Notion view as Safari, not an unclassified WKWebView.
//! Notion uses /Safari/ in its browser detector; WebKit's default UA omits it.
use objc2_foundation::{ns_string, NSBundle, NSString};
use std::sync::OnceLock;

fn safari_user_agent(version: Option<&str>) -> String {
    let version = version
        .filter(|version| {
            !version.is_empty()
                && version
                    .split('.')
                    .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        })
        // The app's minimum macOS version is 13.5, which shipped Safari 16.6.
        .unwrap_or("16.6");
    // Safari freezes these OS / WebKit tokens, including on Apple Silicon.
    format!("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15")
}

pub fn user_agent() -> &'static str {
    static USER_AGENT: OnceLock<String> = OnceLock::new();
    USER_AGENT.get_or_init(|| {
        let version = NSBundle::bundleWithPath(ns_string!("/Applications/Safari.app"))
            .and_then(|bundle| {
                bundle.objectForInfoDictionaryKey(ns_string!("CFBundleShortVersionString"))
            })
            .and_then(|value| value.downcast::<NSString>().ok())
            .map(|value| value.to_string());
        safari_user_agent(version.as_deref())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safari_profile_uses_the_installed_version_without_claiming_chromium() {
        for version in ["16.6", "18.4.1", "26.5"] {
            let ua = safari_user_agent(Some(version));
            assert!(ua.contains("Macintosh"));
            assert!(ua.contains("AppleWebKit/605.1.15"));
            assert!(ua.ends_with(&format!("Version/{version} Safari/605.1.15")));
            assert!(!ua.contains("Chrome") && !ua.contains("Electron"));
        }
    }

    #[test]
    fn missing_or_invalid_safari_metadata_uses_the_minimum_supported_version() {
        for version in [
            None,
            Some(""),
            Some("26..5"),
            Some("26.5 Chrome/100"),
            Some("26.5\r\n"),
        ] {
            assert!(safari_user_agent(version).ends_with("Version/16.6 Safari/605.1.15"));
        }
    }
}
