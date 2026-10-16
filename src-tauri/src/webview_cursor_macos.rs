//! WebKit sends tracking-area events to WKMouseTrackingObserver, bypassing
//! WKWebView.mouseMoved:. Filter that observer for covered host views.
#[cfg(feature = "desktop-smoke")]
use objc2::runtime::AnyClass;
use objc2::{
    define_class, ffi, msg_send,
    rc::{Retained, Weak},
    runtime::{AnyObject, Imp, NSObject, Sel},
    sel, DefinedClass, MainThreadOnly,
};
use objc2_foundation::{MainThreadMarker, NSArray, NSObjectProtocol, NSPoint};
use std::{cell::Cell, sync::OnceLock};

type EventHandler = unsafe extern "C" fn(&AnyObject, Sel, &AnyObject);
struct Handlers {
    moved: Imp,
    entered: Imp,
    exited: Imp,
}
static ORIGINAL: OnceLock<Handlers> = OnceLock::new();
static INSTALLED: OnceLock<Result<(), String>> = OnceLock::new();
static STATE_KEY: u8 = 0;

struct TrackingState {
    // The view owns its observer. A strong reference here would form a cycle.
    view: Weak<AnyObject>,
    was_topmost: Cell<bool>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = TrackingState]
    struct CursorTrackingState;
    unsafe impl NSObjectProtocol for CursorTrackingState {}
);

// AppKit accounts for stacking, hidden views and coordinate flips. The hit may
// be a private WebKit descendant rather than the WKWebView itself.
pub(super) unsafe fn owns_point(view: &AnyObject, point_in_window: NSPoint) -> bool {
    let window: *mut AnyObject = unsafe { msg_send![view, window] };
    let Some(window) = (unsafe { window.as_ref() }) else {
        return false;
    };
    let content: *mut AnyObject = unsafe { msg_send![window, contentView] };
    let Some(content) = (unsafe { content.as_ref() }) else {
        return false;
    };
    // hitTest: takes coordinates in the receiver's superview.
    let parent: *mut AnyObject = unsafe { msg_send![content, superview] };
    let point = match unsafe { parent.as_ref() } {
        Some(parent) => unsafe {
            msg_send![parent, convertPoint: point_in_window, fromView: std::ptr::null::<AnyObject>()]
        },
        None => point_in_window,
    };
    let hit: *mut AnyObject = unsafe { msg_send![content, hitTest: point] };
    unsafe { hit.as_ref() }.is_some_and(|hit| unsafe { msg_send![hit, isDescendantOf: view] })
}

unsafe fn observer(view: &AnyObject) -> Option<Retained<AnyObject>> {
    let areas: Retained<NSArray<AnyObject>> = unsafe { msg_send![view, trackingAreas] };
    for area in &areas {
        let owner: Option<Retained<AnyObject>> = unsafe { msg_send![&*area, owner] };
        if let Some(owner) = owner {
            // Both tracking areas share this owner, even after reconfiguration.
            if owner.class().name().to_bytes() == b"WKMouseTrackingObserver" {
                return Some(owner);
            }
        }
    }
    None
}

unsafe fn state(observer: &AnyObject) -> Option<&CursorTrackingState> {
    let value =
        unsafe { ffi::objc_getAssociatedObject(observer, (&STATE_KEY as *const u8).cast()) };
    unsafe { value.cast::<CursorTrackingState>().as_ref() }
}

#[cfg(feature = "desktop-smoke")]
pub(super) unsafe fn is_attached(view: &AnyObject) -> bool {
    unsafe { observer(view) }.is_some_and(|observer| {
        unsafe { state(&observer) }
            .and_then(|state| state.ivars().view.load())
            .is_some_and(|owner| std::ptr::eq(&*owner, view))
    })
}

unsafe fn forward_event(observer: &AnyObject, event: &AnyObject, exiting: bool) -> bool {
    let Some(state) = (unsafe { state(observer) }) else {
        return true; // Unregistered views retain WebKit's normal behavior.
    };
    if exiting {
        // An exit can be outside the view. Balance an enter/move that WebKit
        // actually received, preserving its modifier-key monitor cleanup.
        return state.ivars().was_topmost.get();
    }
    let point: NSPoint = unsafe { msg_send![event, locationInWindow] };
    let topmost = state
        .ivars()
        .view
        .load()
        .is_some_and(|view| unsafe { owns_point(&view, point) });
    state.ivars().was_topmost.set(topmost);
    topmost
}

unsafe fn deliver(
    observer: &AnyObject,
    selector: Sel,
    event: &AnyObject,
    original: Imp,
    exiting: bool,
) {
    let forward = unsafe { forward_event(observer, event, exiting) };
    #[cfg(feature = "desktop-smoke")]
    if std::env::var_os("AI_PLAYER_CURSOR_TRACE").is_some() && unsafe { state(observer) }.is_some()
    {
        eprintln!("CURSOR HOST {:?} forward={forward}", selector.name());
    }
    if forward {
        // Original methods all have NSResponder's void(id, SEL, NSEvent*) ABI.
        let original: EventHandler = unsafe { std::mem::transmute(original) };
        unsafe { original(observer, selector, event) };
    }
}

unsafe extern "C" fn mouse_moved(observer: &AnyObject, selector: Sel, event: &AnyObject) {
    unsafe {
        deliver(
            observer,
            selector,
            event,
            ORIGINAL.get().unwrap().moved,
            false,
        )
    };
}
unsafe extern "C" fn mouse_entered(observer: &AnyObject, selector: Sel, event: &AnyObject) {
    unsafe {
        deliver(
            observer,
            selector,
            event,
            ORIGINAL.get().unwrap().entered,
            false,
        )
    };
}
unsafe extern "C" fn mouse_exited(observer: &AnyObject, selector: Sel, event: &AnyObject) {
    unsafe {
        deliver(
            observer,
            selector,
            event,
            ORIGINAL.get().unwrap().exited,
            true,
        )
    };
}

unsafe fn install(observer: &AnyObject) -> Result<(), String> {
    INSTALLED
        .get_or_init(|| {
            let class = observer.class();
            let selectors = [sel!(mouseMoved:), sel!(mouseEntered:), sel!(mouseExited:)];
            if !selectors.iter().all(|selector| {
                class
                    .instance_methods()
                    .iter()
                    .any(|m| m.name() == *selector)
            }) {
                return Err("WebKit mouse tracking methods changed".into());
            }
            let methods = selectors.map(|selector| class.instance_method(selector).unwrap());
            ORIGINAL.get_or_init(|| Handlers {
                moved: methods[0].implementation(),
                entered: methods[1].implementation(),
                exited: methods[2].implementation(),
            });
            // Preserve original implementations, layout and isa. In particular,
            // changing a WKWebView's isa breaks macOS 26 fullscreen.
            for (method, handler) in methods.into_iter().zip([
                mouse_moved as EventHandler,
                mouse_entered as EventHandler,
                mouse_exited as EventHandler,
            ]) {
                unsafe {
                    method.set_implementation(std::mem::transmute::<EventHandler, Imp>(handler))
                };
            }
            Ok(())
        })
        .clone()
}

pub async fn attach(view: &tauri::Webview) -> Result<(), String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    view.with_webview(move |platform| {
        let view = unsafe { &*(platform.inner() as *const AnyObject) };
        let result = (|| {
            let observer =
                unsafe { observer(view) }.ok_or("WebKit mouse tracking observer not found")?;
            unsafe { install(&observer) }?;
            if unsafe { state(&observer) }.is_none() {
                let state = CursorTrackingState::alloc(MainThreadMarker::new().unwrap()).set_ivars(
                    TrackingState {
                        view: Weak::new(view),
                        was_topmost: Cell::new(false),
                    },
                );
                let state: Retained<CursorTrackingState> = unsafe { msg_send![super(state), init] };
                unsafe {
                    ffi::objc_setAssociatedObject(
                        Retained::as_ptr(&observer).cast_mut(),
                        (&STATE_KEY as *const u8).cast(),
                        Retained::as_ptr(&state).cast_mut().cast(),
                        ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
                    )
                };
            }
            #[cfg(feature = "desktop-smoke")]
            if std::env::var_os("AI_PLAYER_CURSOR_TRACE").is_some() {
                unsafe { trace_cursor_sets() };
            }
            Ok(())
        })();
        let _ = tx.try_send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .await
        .ok_or("Cursor tracking setup did not complete")?
}

// Diagnostic instrumentation exists only in the isolated desktop-test build.
#[cfg(feature = "desktop-smoke")]
static ORIGINAL_CURSOR_SET: OnceLock<Imp> = OnceLock::new();

#[cfg(feature = "desktop-smoke")]
unsafe fn trace_cursor_sets() {
    let class = AnyClass::get(c"NSCursor").unwrap();
    ORIGINAL_CURSOR_SET.get_or_init(|| {
        let method = class.instance_method(sel!(set)).unwrap();
        unsafe {
            method.set_implementation(std::mem::transmute::<
                unsafe extern "C" fn(&AnyObject, Sel),
                Imp,
            >(traced_cursor_set))
        }
    });
}

#[cfg(feature = "desktop-smoke")]
unsafe extern "C" fn traced_cursor_set(cursor: &AnyObject, selector: Sel) {
    let class = AnyClass::get(c"NSCursor").unwrap();
    let arrow: *const AnyObject = unsafe { msg_send![class, arrowCursor] };
    let hand: *const AnyObject = unsafe { msg_send![class, pointingHandCursor] };
    let text: *const AnyObject = unsafe { msg_send![class, IBeamCursor] };
    let kind = if std::ptr::eq(cursor, arrow) {
        "arrow"
    } else if std::ptr::eq(cursor, hand) {
        "hand"
    } else if std::ptr::eq(cursor, text) {
        "text"
    } else {
        "other"
    };
    eprintln!("CURSOR SET {kind}");
    let original: unsafe extern "C" fn(&AnyObject, Sel) =
        unsafe { std::mem::transmute(*ORIGINAL_CURSOR_SET.get().unwrap()) };
    unsafe { original(cursor, selector) };
}
