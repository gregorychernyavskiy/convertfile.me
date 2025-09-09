// Theme Toggle Functionality
document.addEventListener('DOMContentLoaded', function() {
    console.log('Theme toggle script loaded');
    
    // Create theme toggle button
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.setAttribute('aria-label', 'Toggle theme');
    
    console.log('Theme toggle button created');
    
    // Find the navbar and add the theme toggle
    const navbar = document.querySelector('.nav-bar');
    console.log('Navbar found:', navbar);
    
    if (navbar) {
        navbar.appendChild(themeToggle);
        console.log('Theme toggle button added to navbar');
    } else {
        console.error('Navbar not found!');
    }
    
    // Check for saved theme preference or default to 'light'
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    console.log('Current theme set to:', currentTheme);
    
    // Update toggle button icon based on current theme
    updateToggleIcon(currentTheme);
    
    // Theme toggle click handler
    themeToggle.addEventListener('click', function() {
        console.log('Theme toggle clicked');
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateToggleIcon(newTheme);
        console.log('Theme switched to:', newTheme);
        
        // Add a subtle animation to the button
        themeToggle.style.transform = 'scale(0.9)';
        setTimeout(() => {
            themeToggle.style.transform = 'scale(1)';
        }, 150);
    });
    
    function updateToggleIcon(theme) {
        if (theme === 'dark') {
            // Light/brightness icon for light mode switch
            themeToggle.innerHTML = `
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="8" r="3"/>
                    <path d="M8 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 1zm0 12a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 13zm7-5a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5zM2.5 8a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5zm10.657-4.657a.5.5 0 0 1 0 .707l-.707.707a.5.5 0 0 1-.707-.707l.707-.707a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707l-.707.707a.5.5 0 0 1-.707-.707l.707-.707a.5.5 0 0 1 .707 0zm9.193 0a.5.5 0 0 1-.707 0l-.707-.707a.5.5 0 0 1 .707-.707l.707.707a.5.5 0 0 1 0 .707zM4.464 4.464a.5.5 0 0 1-.707 0l-.707-.707a.5.5 0 0 1 .707-.707l.707.707a.5.5 0 0 1 0 .707z"/>
                </svg>
            `;
            themeToggle.setAttribute('title', 'Switch to light mode');
        } else {
            // Dark/contrast icon for dark mode switch
            themeToggle.innerHTML = `
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14.5c-3.59 0-6.5-2.91-6.5-6.5S4.41 1.5 8 1.5V14.5z"/>
                </svg>
            `;
            themeToggle.setAttribute('title', 'Switch to dark mode');
        }
        console.log('Toggle icon updated for theme:', theme);
    }
});
