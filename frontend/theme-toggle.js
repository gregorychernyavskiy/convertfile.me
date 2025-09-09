// Theme Toggle Functionality
document.addEventListener('DOMContentLoaded', function() {
    console.log('Theme toggle script loaded');
    
    // Create theme toggle button
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.setAttribute('aria-label', 'Toggle theme');
    themeToggle.innerHTML = '🌙';
    
    console.log('Theme toggle button created');
    
    // Find the navbar and add the theme toggle
    const navbar = document.querySelector('.nav-bar');
    console.log('Navbar found:', navbar);
    
    if (navbar) {
        // Add the theme toggle as the last element in the navbar
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
        themeToggle.style.transform = 'translateY(-50%) scale(0.9)';
        setTimeout(() => {
            themeToggle.style.transform = 'translateY(-50%) scale(1)';
        }, 150);
    });
    
    function updateToggleIcon(theme) {
        themeToggle.innerHTML = theme === 'dark' ? '☀️' : '🌙';
        themeToggle.setAttribute('title', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
        console.log('Toggle icon updated for theme:', theme);
    }
});
