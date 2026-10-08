//! Wry 0.55 does not implement WKUIDelegate.webViewDidClose. Forward its other
//! handlers unchanged, and close only the corresponding Tauri popup on this event.
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject, Sel},
    DefinedClass, MainThreadOnly,
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol};
use objc2_web_kit::{WKUIDelegate, WKWebView};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Manager, WebviewWindow};

struct DelegateState {
    original: Retained<ProtocolObject<dyn WKUIDelegate>>,
    close: Box<dyn Fn()>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = DelegateState]
    struct NotionPopupUIDelegate;

    unsafe impl NSObjectProtocol for NotionPopupUIDelegate {
        #[unsafe(method(respondsToSelector:))]
        fn responds(&self, selector: Sel) -> bool {
            let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
            own || self.ivars().original.respondsToSelector(selector)
        }
    }

    impl NotionPopupUIDelegate {
        #[unsafe(method(forwardingTargetForSelector:))]
        fn forward(&self, _selector: Sel) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().original).cast::<AnyObject>().cast_mut()
        }
    }

    unsafe impl WKUIDelegate for NotionPopupUIDelegate {
        #[unsafe(method(webViewDidClose:))]
        unsafe fn did_close(&self, _webview: &WKWebView) {
            (self.ivars().close)();
        }
    }
);

// WKWebView keeps its UI delegate weakly. Own wrappers until their native window
// is destroyed, on the AppKit thread; all original popup/file-dialog handlers remain alive.
thread_local! {
    static DELEGATES: RefCell<HashMap<String, Retained<NotionPopupUIDelegate>>> = RefCell::new(HashMap::new());
}

pub fn attach(window: &WebviewWindow) -> tauri::Result<()> {
    let label = window.label().to_string();
    let app = window.app_handle().clone();
    let cleanup_label = label.clone();
    let cleanup_app = app.clone();
    let script_closed = Arc::new(AtomicBool::new(false));
    let native_close_requested = Arc::new(AtomicBool::new(false));
    let closing = script_closed.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if !closing.load(Ordering::SeqCst) {
                // Route the title-bar close through WebKit first so the opener
                // observes popup.closed and can reset a canceled sign-in button.
                api.prevent_close();
                if !native_close_requested.swap(true, Ordering::SeqCst) {
                    if let Some(window) = cleanup_app.get_webview_window(&cleanup_label) {
                        let _ = window.eval("window.close()");
                    }
                    let app = cleanup_app.clone();
                    let label = cleanup_label.clone();
                    let closing = closing.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(500));
                        if !closing.swap(true, Ordering::SeqCst) {
                            if let Some(window) = app.get_webview_window(&label) {
                                let _ = window.close();
                            }
                        }
                    });
                }
            }
        }
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let label = cleanup_label.clone();
            let _ = cleanup_app.run_on_main_thread(move || {
                DELEGATES.with(|delegates| {
                    delegates.borrow_mut().remove(&label);
                });
            });
        }
    });
    window.with_webview(move |platform| {
        let view = unsafe { &*(platform.inner() as *const WKWebView) };
        let Some(original) = (unsafe { view.UIDelegate() }) else {
            return;
        };
        let closing_label = label.clone();
        let delegate = NotionPopupUIDelegate::alloc(MainThreadMarker::new().unwrap()).set_ivars(
            DelegateState {
                original,
                close: Box::new(move || {
                    script_closed.store(true, Ordering::SeqCst);
                    let app = app.clone();
                    let label = closing_label.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(window) = app.get_webview_window(&label) {
                            let _ = window.close();
                        }
                    });
                }),
            },
        );
        let delegate: Retained<NotionPopupUIDelegate> = unsafe { msg_send![super(delegate), init] };
        unsafe { view.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
        DELEGATES.with(|delegates| {
            delegates.borrow_mut().insert(label, delegate);
        });
    })
}
