// This script disables right-clicking, text selection, and common copy shortcuts.

document.addEventListener('DOMContentLoaded', function() {

    // 1. Disable Right-Click Context Menu
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    // 2. Disable Keyboard Shortcuts (Ctrl+C, Ctrl+U, F12)
    document.addEventListener('keydown', function(e) {
        // Disable Ctrl+C (Copy)
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
        }
        // Disable Ctrl+U (View Source)
        if (e.ctrlKey && e.key === 'u') {
            e.preventDefault();
        }
        // Disable F12 (Developer Tools)
        if (e.key === 'F12') {
            e.preventDefault();
        }
    });

    // 3. Disable Dragging of elements
    document.addEventListener('dragstart', function(e) {
        e.preventDefault();
    });

});
