// scripts/helpers/dialog-util.js
const { DialogV2 } = foundry.applications.api;

/**
 * Standard render handler to attach close events to the header cross and prevent form submission.
 * This ensures consistency across all Reign dialogs in V13.
 */
export function reignRender(event, html) {
    let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
    if (!element) return;

    // Ensure the dialog window has the correct class for system styling
    element.classList.add("reign-dialog-window");

    const closeBtn = element.querySelector('.header-control[data-action="close"]');
    if (closeBtn) closeBtn.addEventListener("pointerdown", () => { 
        element.classList.remove("reign-dialog-window"); 
        element.style.display = "none"; 
    });

    const f = element.querySelector("form");
    if (f) f.addEventListener("submit", e => e.preventDefault());
    
    return element;
}

/**
 * Standard cleanup function for closing dialogs cleanly in V13.
 * Prevents "ghost" elements from remaining in the DOM if the application isn't fully destroyed.
 */
export function reignClose(d) {
    if (d.element) { 
        d.element.classList.remove("reign-dialog-window"); 
        d.element.style.display = "none"; 
    }
    if (typeof d.close === 'function') d.close({ animate: false });
}

/**
 * Wraps DialogV2.wait for standard Reign dialogs.
 * AUDIT FIX B7: Uses try/finally to ensure reignClose always executes, 
 * even if the provided callback throws an error.
 */
export async function reignDialog(title, content, callback, options = {}) {
    const { defaultLabel = "Confirm", width = 400, rejectClose = false, buttons = null, render = reignRender } = options;
    
    const defaultButtons = [{
        action: "confirm", 
        label: defaultLabel, 
        default: true,
        callback: (e, b, d) => {
            try {
                return callback ? callback(e, b, d) : true;
            } finally {
                reignClose(d);
            }
        }
    }];

    return await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title, resizable: true },
        position: { width, height: "auto" },
        content,
        rejectClose,
        render: render,
        buttons: buttons || defaultButtons
    });
}

/**
 * Standard Yes/No confirmation dialog.
 * AUDIT FIX B7: Standardized with try/finally to prevent ghosting.
 */
export async function reignConfirm(title, content) {
    return await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title },
        content: `<div class="reign-dialog-form">${content}</div>`,
        rejectClose: false,
        render: reignRender,
        buttons: [
            { 
                action: "yes", 
                label: "Yes", 
                default: true, 
                callback: (e, b, d) => { 
                    try {
                        return true; 
                    } finally {
                        reignClose(d); 
                    }
                } 
            },
            { 
                action: "no", 
                label: "No", 
                callback: (e, b, d) => { 
                    try {
                        return false; 
                    } finally {
                        reignClose(d); 
                    }
                } 
            }
        ]
    });
}

/**
 * Standard Alert dialog (OK button only).
 * AUDIT FIX B7: Standardized with try/finally for safe DOM cleanup.
 */
export async function reignAlert(title, content) {
    return await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title },
        content: `<div class="reign-dialog-form">${content}</div>`,
        rejectClose: false,
        render: reignRender,
        buttons: [
            { 
                action: "ok", 
                label: "OK", 
                default: true, 
                callback: (e, b, d) => { 
                    try {
                        return true; 
                    } finally {
                        reignClose(d); 
                    }
                } 
            }
        ]
    });
}